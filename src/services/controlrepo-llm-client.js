// backend/src/services/controlrepo-llm-client.js
// Cliente interno para delegar consultas LLM a ControlRepo
// ControlFile actúa como orquestador/proxy - NO implementa lógica LLM propia

const axios = require('axios');
const { logger } = require('../utils/logger');

const CONTROLREPO_URL = process.env.CONTROLREPO_URL;
const CONTROLFILE_SIGNATURE = process.env.CONTROLFILE_SIGNATURE;

/**
 * Realiza una consulta LLM delegando completamente a ControlRepo
 * 
 * @param {Object} payload - Payload según contrato de ControlRepo
 * @param {string} payload.question - Pregunta del usuario
 * @param {string} payload.repositoryId - ID del repositorio
 * @param {string} [payload.conversationId] - ID de conversación (opcional)
 * @returns {Promise<Object>} Respuesta de ControlRepo
 */
async function queryRepositoryLLM(payload) {
  if (!CONTROLREPO_URL) {
    throw new Error('CONTROLREPO_URL no está configurado en variables de entorno');
  }
  
  if (!CONTROLFILE_SIGNATURE) {
    throw new Error('CONTROLFILE_SIGNATURE no está configurado en variables de entorno');
  }
  
  const url = `${CONTROLREPO_URL}/api/chat/query`;
  
  logger.info('Delegando consulta LLM a ControlRepo', {
    repositoryId: payload.repositoryId,
    questionLength: payload.question?.length,
    hasConversationId: !!payload.conversationId
  });
  
  try {
    // Construir payload según contrato de ControlRepo
    const requestBody = {
      repositoryId: payload.repositoryId,
      question: payload.question
    };
    
    // Agregar conversationId solo si está presente
    if (payload.conversationId) {
      requestBody.conversationId = payload.conversationId;
    }
    
    // Intentar con retry para 429
    let response;
    let retryCount = 0;
    const maxRetries = 1; // Un solo retry
    const retryDelay = 4000; // 4 segundos
    
    while (retryCount <= maxRetries) {
      try {
        response = await axios.post(url, requestBody, {
          headers: {
            'Content-Type': 'application/json',
            'X-ControlFile-Signature': CONTROLFILE_SIGNATURE
          },
          timeout: 120000, // 2 minutos de timeout para consultas LLM
          validateStatus: (status) => status < 500 // No lanzar error para 4xx, solo para 5xx
        });
        
        // Si no es 429, salir del loop
        if (response.status !== 429) {
          break;
        }
        
        // Si es 429 y aún tenemos retries disponibles
        if (retryCount < maxRetries) {
          logger.warn('ControlRepo retornó 429, reintentando después de delay', {
            repositoryId: payload.repositoryId,
            retryCount: retryCount + 1,
            delay: retryDelay
          });
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          retryCount++;
          continue;
        }
        
        // Si es 429 y no hay más retries, salir del loop para manejar el error
        break;
      } catch (error) {
        // Si es un error de red/timeout, no hacer retry
        if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
          throw error;
        }
        // Si es otro error, reintentar solo si es 429 y tenemos retries
        if (error.response?.status === 429 && retryCount < maxRetries) {
          logger.warn('ControlRepo retornó 429, reintentando después de delay', {
            repositoryId: payload.repositoryId,
            retryCount: retryCount + 1,
            delay: retryDelay
          });
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          retryCount++;
          continue;
        }
        throw error;
      }
    }
    
    // Si ControlRepo retorna error 429, propagarlo específicamente
    if (response.status === 429) {
      logger.error('ControlRepo retornó error 429 (Too Many Requests)', {
        status: response.status,
        data: response.data,
        repositoryId: payload.repositoryId,
        retries: retryCount
      });
      const error = new Error(response.data?.message || response.data?.error || 'Demasiadas solicitudes. Intenta de nuevo en unos momentos.');
      error.statusCode = 429;
      error.responseData = response.data;
      throw error;
    }
    
    // Si ControlRepo retorna otro error 4xx, propagar el status code
    if (response.status >= 400 && response.status < 500) {
      // 409 Conflict es esperado (concurrencia), no es un error real
      if (response.status === 409) {
        logger.info('ControlRepo retornó 409 Conflict (concurrencia esperada)', {
          status: response.status,
          data: response.data,
          repositoryId: payload.repositoryId
        });
      } else {
        logger.error('ControlRepo retornó error 4xx', {
          status: response.status,
          data: response.data,
          repositoryId: payload.repositoryId
        });
      }
      const error = new Error(`ControlRepo rechazó la consulta: ${response.data?.message || response.data?.error || 'Error desconocido'}`);
      error.statusCode = response.status;
      error.responseData = response.data;
      throw error;
    }
    
    // Si ControlRepo retorna error 5xx, también propagarlo
    if (response.status >= 500) {
      logger.error('ControlRepo retornó error 5xx', {
        status: response.status,
        data: response.data,
        repositoryId: payload.repositoryId
      });
      const error = new Error(`ControlRepo reportó error interno: ${response.data?.message || response.data?.error || 'Error desconocido'}`);
      error.statusCode = response.status;
      error.responseData = response.data;
      throw error;
    }
    
    logger.info('Consulta LLM completada exitosamente', {
      repositoryId: payload.repositoryId,
      answerLength: response.data?.answer?.length,
      filesCount: response.data?.files?.length,
      hasDebug: !!response.data?.debug
    });
    
    // Retornar respuesta tal cual sin modificar
    return response.data;
    
  } catch (error) {
    // Manejar errores de red o timeout
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      logger.error('Error de conexión con ControlRepo', {
        url,
        error: error.message,
        code: error.code,
        repositoryId: payload.repositoryId
      });
      throw new Error(`No se pudo conectar con ControlRepo: ${error.message}`);
    }
    
    // Si el error ya tiene mensaje (de los throws anteriores), propagarlo
    if (error.message && !error.response) {
      throw error;
    }
    
    // Error inesperado
    logger.error('Error inesperado llamando a ControlRepo', {
      url,
      error: error.message,
      stack: error.stack,
      repositoryId: payload.repositoryId
    });
    throw new Error(`Error llamando a ControlRepo: ${error.message}`);
  }
}

module.exports = {
  queryRepositoryLLM
};
