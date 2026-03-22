// backend/src/services/chat-service.js
// Servicio de chat/query sobre repositorios indexados
// ControlFile actúa como orquestador/proxy - delega completamente el razonamiento LLM a ControlRepo
// SOLO funciona con repositorios en estado 'ready'

const { logger } = require('../utils/logger');
const repositoryStore = require('./repository-store');
const { isValidRepositoryId } = require('../utils/repository-id');
const { queryRepositoryLLM } = require('./controlrepo-llm-client');

// Lock por conversación/repositorio para evitar múltiples consultas simultáneas
const activeQueries = new Map();
const chatStatuses = new Map();
const CHAT_STATUS_TTL_MS = 5 * 60 * 1000;

function updateChatStatus(conversationId, status, metadata = {}) {
  chatStatuses.set(conversationId, {
    status,
    updatedAt: Date.now(),
    ...metadata
  });
}

function pruneChatStatuses() {
  const now = Date.now();
  for (const [conversationId, value] of chatStatuses.entries()) {
    if (now - value.updatedAt > CHAT_STATUS_TTL_MS) {
      chatStatuses.delete(conversationId);
    }
  }
}

function getChatStatus(conversationId) {
  if (!conversationId) {
    return { status: 'idle' };
  }

  pruneChatStatuses();
  return chatStatuses.get(conversationId) || { status: 'idle' };
}

/**
 * Procesa una query de chat sobre un repositorio
 * 
 * IMPORTANTE: Este servicio SOLO funciona si el repositorio está en estado 'ready'
 * NO debe ser llamado directamente - debe validarse el estado primero
 * 
 * ControlFile NO implementa lógica LLM propia.
 * Recolecta contexto (index, projectBrain, metrics) y delega completamente a ControlRepo.
 * 
 * @param {string} repositoryId - ID del repositorio
 * @param {string} question - Pregunta del usuario
 * @param {string|null} conversationId - ID de conversación (opcional, para contexto)
 * @returns {Promise<{ response: string, conversationId: string, sources: Array, ... }>}
 */
async function queryRepository(repositoryId, question, conversationId = null) {
  if (!isValidRepositoryId(repositoryId)) {
    throw new Error('repositoryId inválido');
  }
  
  if (!question || typeof question !== 'string' || question.trim().length === 0) {
    throw new Error('question es requerida y no puede estar vacía');
  }
  
  logger.info('Procesando query de chat', { repositoryId, questionLength: question.length });
  
  // 1. Verificar que el repositorio existe y está listo
  const status = await repositoryStore.getStatus(repositoryId);
  if (status !== 'ready' && status !== 'completed') {
    throw new Error(`Repositorio no está listo para queries. Estado actual: ${status}`);
  }
  
  // 2. Generar conversationId si no existe
  if (!conversationId) {
    conversationId = `conv-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  }
  updateChatStatus(conversationId, 'processing', { repositoryId });
  
  // 3. Verificar lock por conversación/repositorio
  // Usar conversationId si existe, sino repositoryId como clave del lock
  const lockKey = conversationId || repositoryId;
  
  if (activeQueries.has(lockKey)) {
    logger.warn('Consulta rechazada: ya hay una consulta en curso', {
      repositoryId,
      conversationId,
      lockKey
    });
    throw new Error('Ya hay una consulta en curso para esta conversación. Espera a que termine.');
  }
  
  // 4. Adquirir lock
  activeQueries.set(lockKey, Date.now());
  
  try {
    // 5. Construir payload según contrato de ControlRepo
    const payload = {
      question,
      repositoryId,
      conversationId: conversationId || undefined // Solo incluir si existe
    };
    
    // 6. Delegar completamente a ControlRepo
    logger.info('Delegando consulta LLM a ControlRepo', {
      repositoryId,
      hasConversationId: !!conversationId
    });
    
    let controlRepoResponse;
    try {
      controlRepoResponse = await queryRepositoryLLM(payload);
    } catch (error) {
      // Errores de ControlRepo se propagan (incluyendo 429)
      // 409 Conflict es esperado (concurrencia), no es un error real
      if (error.statusCode === 409) {
        logger.info('ControlRepo retornó 409 Conflict (concurrencia esperada)', {
          repositoryId,
          error: error.message,
          statusCode: error.statusCode
        });
      } else {
        logger.error('Error delegando a ControlRepo', {
          repositoryId,
          error: error.message,
          stack: error.stack,
          statusCode: error.statusCode
        });
      }
      throw error;
    }
  
    // 7. Transformar respuesta de ControlRepo al formato del frontend
    // Mantener compatibilidad con contrato actual del frontend
    // pero incluir campos adicionales si están disponibles
    const response = {
      response: controlRepoResponse.answer || '',
      conversationId,
      sources: (controlRepoResponse.files || []).map(file => ({
        path: file.path,
        name: file.name || file.path.split('/').pop(),
        lines: [] // ControlRepo puede proporcionar líneas en el futuro
      }))
    };
    
    // Incluir campos adicionales si están disponibles (para compatibilidad futura)
    if (controlRepoResponse.findings) {
      response.findings = controlRepoResponse.findings;
    }
    
    if (controlRepoResponse.debug) {
      response.debug = controlRepoResponse.debug;
    }
    
    if (controlRepoResponse.timestamp) {
      response.timestamp = controlRepoResponse.timestamp;
    }
    
    logger.info('Query procesada exitosamente', { 
      repositoryId, 
      conversationId,
      responseLength: response.response.length,
      sourcesCount: response.sources.length
    });
    
    updateChatStatus(conversationId, 'completed', { repositoryId });
    return response;
  } catch (error) {
    updateChatStatus(conversationId, 'error', { repositoryId, error: error.message });
    throw error;
  } finally {
    // 8. Liberar lock siempre, incluso si hay error
    activeQueries.delete(lockKey);
  }
}

module.exports = {
  queryRepository,
  getChatStatus
};
