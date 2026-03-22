// backend/src/services/repository-indexer.js
// Servicio de indexación de repositorios GitHub
const { logger } = require('../utils/logger');

/**
 * Indexa un repositorio de GitHub
 * 
 * MODELO URL-ONLY + TOKEN POR ENTORNO:
 * - Primero intenta acceso público (sin Authorization header)
 * - Si responde 401/403/404 → retry automático con process.env.GITHUB_TOKEN
 * - El parámetro accessToken se ignora (mantenido por compatibilidad)
 * - NO lee tokens desde Firestore
 * - NO falla por ausencia de accessToken
 * 
 * @param {string} owner - Propietario del repositorio
 * @param {string} repo - Nombre del repositorio
 * @param {string|null|undefined} accessToken - IGNORADO (mantenido por compatibilidad, no se usa)
 * @param {string|null|undefined} branch - Rama a indexar (opcional, usa default branch si no se proporciona)
 * @returns {Promise<{ files: Array, tree: Object, stats: Object, branch: string, branchSha: string }>}
 */
async function indexRepository(owner, repo, accessToken, branch) {
  logger.info('Iniciando indexación de repositorio', { 
    owner, 
    repo, 
    branch: branch || 'default'
    // NOTA: accessToken se ignora - solo se usa process.env.GITHUB_TOKEN como fallback
  });

  if (accessToken) {
    logger.info('Token OAuth de usuario ignorado para indexación', {
      owner,
      repo
    });
  }
  
  const baseHeaders = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'controlfile-backend'
  };

  // Token por entorno - fallback automático si acceso público falla
  const fallbackToken = process.env.GITHUB_TOKEN || null;

  /**
   * Flujo de acceso: público primero, luego fallback a token de entorno
   * 1. Intenta acceso público (sin Authorization header)
   * 2. Si 401/403/404 → retry con process.env.GITHUB_TOKEN
   * 3. Nunca falla por ausencia de accessToken en parámetros
   */
  const fetchWithFallback = async (url) => {
    const publicResponse = await fetch(url, { headers: baseHeaders });

    if ((publicResponse.status === 401 || publicResponse.status === 403 || publicResponse.status === 404) && fallbackToken) {
      logger.info('Acceso público falló, usando token de entorno', { 
        status: publicResponse.status,
        url: url.replace(/\/\/api\.github\.com\/repos\/[^\/]+\/[^\/]+/, '//api.github.com/repos/OWNER/REPO')
      });
      const authHeaders = {
        ...baseHeaders,
        Authorization: `Bearer ${fallbackToken}`
      };
      return fetch(url, { headers: authHeaders });
    }

    return publicResponse;
  };
  
  try {
    // 1. Obtener información del repositorio
    const repoInfo = await fetchWithFallback(`https://api.github.com/repos/${owner}/${repo}`);
    
    if (!repoInfo.ok) {
      const errorText = await repoInfo.text();
      throw new Error(`Error obteniendo info del repositorio: ${repoInfo.status} - ${errorText}`);
    }
    
    const repoData = await repoInfo.json();
    
    // 2. Resolver branch: usar default branch si no se proporciona
    let resolvedBranch = branch || repoData.default_branch;
    if (!resolvedBranch) {
      throw new Error('No se pudo determinar el branch a indexar');
    }
    
    logger.info('Branch a indexar', { branch: resolvedBranch, wasProvided: !!branch });
    
    // 3. Resolver SHA del branch (si no es un SHA completo)
    let branchSha = resolvedBranch;
    if (!resolvedBranch.match(/^[0-9a-f]{40}$/)) {
      const branchInfo = await fetchWithFallback(`https://api.github.com/repos/${owner}/${repo}/branches/${resolvedBranch}`);
      
      if (!branchInfo.ok) {
        const errorText = await branchInfo.text();
        throw new Error(`Error obteniendo branch: ${branchInfo.status} - ${errorText}`);
      }
      
      const branchData = await branchInfo.json();
      branchSha = branchData.commit.sha;
      logger.info('Branch resuelto a SHA', { branch: resolvedBranch, sha: branchSha });
    }
    
    // 4. Obtener árbol completo del repositorio
    const treeResponse = await fetchWithFallback(`https://api.github.com/repos/${owner}/${repo}/git/trees/${branchSha}?recursive=1`);
    
    if (!treeResponse.ok) {
      const errorText = await treeResponse.text();
      throw new Error(`Error obteniendo árbol: ${treeResponse.status} - ${errorText}`);
    }
    
    const treeData = await treeResponse.json();
    
    // 5. Filtrar solo archivos (excluir directorios)
    const files = treeData.tree.filter(item => item.type === 'blob');
    
    // 6. Obtener contenido de archivos importantes (limitado a primeros 100 archivos para evitar rate limits)
    const importantFiles = files.slice(0, 100).filter(file => {
      const ext = file.path.split('.').pop()?.toLowerCase();
      const importantExtensions = ['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'go', 'rs', 'md', 'json', 'yaml', 'yml', 'txt'];
      return importantExtensions.includes(ext);
    });
    
    const fileContents = [];
    for (const file of importantFiles) {
      try {
        const contentResponse = await fetchWithFallback(`https://api.github.com/repos/${owner}/${repo}/contents/${file.path}?ref=${branchSha}`);
        
        if (contentResponse.ok) {
          const contentData = await contentResponse.json();
          if (contentData.encoding === 'base64' && contentData.content) {
            const content = Buffer.from(contentData.content, 'base64').toString('utf-8');
            fileContents.push({
              path: file.path,
              sha: file.sha,
              size: file.size,
              content: content.substring(0, 10000) // Limitar tamaño para evitar problemas
            });
          }
        }
      } catch (error) {
        logger.warn('Error obteniendo contenido de archivo', { path: file.path, error: error.message });
      }
    }
    
    // 7. Calcular estadísticas
    const stats = {
      totalFiles: files.length,
      totalSize: files.reduce((sum, file) => sum + (file.size || 0), 0),
      languages: {},
      extensions: {},
      indexedFiles: fileContents.length
    };
    
    files.forEach(file => {
      const ext = file.path.split('.').pop()?.toLowerCase() || 'no-ext';
      stats.extensions[ext] = (stats.extensions[ext] || 0) + 1;
      
      // Detectar lenguaje por extensión
      const langMap = {
        'js': 'JavaScript', 'ts': 'TypeScript', 'jsx': 'JavaScript',
        'tsx': 'TypeScript', 'py': 'Python', 'java': 'Java',
        'go': 'Go', 'rs': 'Rust', 'md': 'Markdown', 'json': 'JSON',
        'yaml': 'YAML', 'yml': 'YAML', 'txt': 'Text'
      };
      const lang = langMap[ext] || 'Other';
      stats.languages[lang] = (stats.languages[lang] || 0) + 1;
    });
    
    logger.info('Indexación completada', { 
      owner, 
      repo, 
      totalFiles: stats.totalFiles,
      indexedFiles: stats.indexedFiles 
    });
    
    return {
      files: fileContents,
      tree: treeData,
      stats,
      branch: resolvedBranch,
      branchSha,
      repoInfo: {
        name: repoData.name,
        description: repoData.description,
        language: repoData.language,
        defaultBranch: repoData.default_branch,
        stars: repoData.stargazers_count,
        forks: repoData.forks_count,
        createdAt: repoData.created_at,
        updatedAt: repoData.updated_at
      }
    };
  } catch (error) {
    logger.error('Error indexando repositorio', { owner, repo, error: error.message });
    throw error;
  }
}

module.exports = {
  indexRepository
};
