/**
 * SAPI API - Integração e Gerenciamento do WhatsApp Web (Puppeteer/WWebJS)
 * Desenvolvido por: Marlon Souza
 * Licença: Atribuição Obrigatória (Manter Créditos)
 * 
 * Assinatura: Marlon Souza © 2026
 */

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');

// Patch LocalAuth.prototype.logout para evitar quedas do Node.js no Windows por arquivos bloqueados/ocupados (EBUSY) pelo Chromium.
LocalAuth.prototype.logout = async function() {
    if (this.userDataDir) {
        try {
            const fsPromise = require('fs/promises');
            await fsPromise.rm(this.userDataDir, { recursive: true, force: true });
        } catch (e) {
            console.warn(`[Patch LocalAuth] Ignorando falha ao remover pasta de sessão no logout (recurso ocupado): ${e.message}`);
        }
    }
};

const axios = require('axios');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const db = require('./database');
const EventEmitter = require('events');

dotenv.config();

const instances = new Map();
const clientEvents = new EventEmitter();

// Helper para disparar webhooks específicos
async function fireWebhook(url, payload) {
    if (!url) return;
    try {
        await axios.post(url, payload);
    } catch (e) {
        console.error(`[Webhook Erro] URL: ${url} - ${e.message}`);
    }
}

function addMessageLog(instanceId, msg) {
    const instance = instances.get(instanceId);
    if (!instance) return;
    instance.messages.unshift(msg);
    if (instance.messages.length > 50) instance.messages.pop();
}

async function createInstance(configData) {
    const instanceId = configData.id;
    if (instances.has(instanceId)) throw new Error('Instância já existe');

    // Salvar no BD
    await db.saveInstance(configData);

    const instanceData = {
        ...configData,
        client: null,
        status: 'STARTING',
        qrCode: null,
        messages: []
    };

    const puppeteerOptions = {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    };

    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        puppeteerOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    }

    // Sanitize instanceId for LocalAuth to prevent 'Invalid clientId' crashes
    const safeClientId = String(instanceId).replace(/[^a-zA-Z0-9_-]/g, '_');

    const sessionFolder = path.join(__dirname, '.wwebjs_auth', `session-${safeClientId}`);
    const lockFiles = [
        path.join(sessionFolder, 'Default', 'LOCK'),
        path.join(sessionFolder, 'LOCK'),
        path.join(sessionFolder, 'SingletonLock'),
        path.join(sessionFolder, 'SingletonCookie'),
        path.join(sessionFolder, 'SingletonSocket'),
        path.join(sessionFolder, 'DevToolsActivePort')
    ];
    for (const file of lockFiles) {
        try {
            fs.unlinkSync(file);
            console.log(`[${instanceId}] Limpeza preventiva: Arquivo de trava removido (${path.basename(file)})`);
        } catch (e) {
            // Ignora se o arquivo não existir ou não puder ser apagado
        }
    }

    const client = new Client({
        authStrategy: new LocalAuth({ clientId: safeClientId }),
        puppeteer: puppeteerOptions
    });

    instanceData.client = client;
    instances.set(instanceId, instanceData);

    client.on('qr', (qr) => {
        console.log(`[${instanceId}] Escaneie o QR Code`);
        instanceData.status = 'QR_READY';
        instanceData.qrCode = qr;
        clientEvents.emit('qr', { instanceId, qr });
    });

    client.on('ready', () => {
        console.log(`[${instanceId}] ✅ Conectado!`);
        instanceData.status = 'CONNECTED';
        instanceData.qrCode = null;
        fireWebhook(configData.wh_connect, { event: 'connected', instance: instanceId });
        clientEvents.emit('ready', { instanceId });
    });

    client.on('disconnected', (reason) => {
        console.log(`[${instanceId}] ❌ Desconectado:`, reason);
        instanceData.status = 'DISCONNECTED';
        instanceData.qrCode = null;
        fireWebhook(configData.wh_disconnect, { event: 'disconnected', instance: instanceId, reason });
        clientEvents.emit('disconnected', { instanceId, reason });
    });

    // Lógica Avançada (S-API Features)
    client.on('message', async (msg) => {
        // Ao Receber
        const payload = { event: 'message_received', instance: instanceId, msg };
        fireWebhook(configData.wh_message_in, payload);

        // Interceptador de Opt-out Automático
        if (msg.body && typeof msg.body === 'string') {
            const bodyUpper = msg.body.trim().toUpperCase();
            if (['PARE', 'SAIR', 'STOP', 'CANCELAR', 'NÃO QUERO', 'DESCADASTRAR'].includes(bodyUpper)) {
                try {
                    const senderId = msg.author || msg.from;
                    const numberOnly = senderId.split('@')[0];
                    await db.optOutContact(instanceId, numberOnly);
                    console.log(`[OPT-OUT] O contato ${numberOnly} solicitou descadastro da instância ${instanceId}. Fila será bloqueada para ele.`);
                } catch(e) {
                    console.error('[OPT-OUT] Erro ao processar opt-out:', e);
                }
            }
        }

        // Propaga evento SSE de mensagem recebida com mapeamento robusto
        let senderName = null;
        const senderId = msg.author || msg.from;
        try {
            const contact = await msg.getContact();
            senderName = contact.name || contact.pushname || contact.verifiedName || senderId.split('@')[0];
        } catch (e) {
            senderName = msg._data?.notifyName || msg._data?.pushname || senderId.split('@')[0];
        }

        let mentions = {};
        if (msg.mentionedIds && msg.mentionedIds.length > 0) {
            try {
                mentions = await getMentionsMetadata(client, msg.mentionedIds);
            } catch (e) {
                console.error('[SSE message mentions error]', e);
            }
        }

        clientEvents.emit('message', {
            instanceId,
            msg: {
                id: msg.id.id,
                body: msg.body,
                type: msg.type,
                timestamp: msg.timestamp,
                fromMe: msg.fromMe,
                from: msg.from,
                to: msg.to,
                sender: senderId,
                senderName: senderName,
                hasMedia: msg.hasMedia,
                mimetype: msg._data?.mimetype || msg.mimetype || (msg.type === 'image' ? 'image/jpeg' : msg.type === 'video' ? 'video/mp4' : msg.type === 'audio' || msg.type === 'ptt' ? 'audio/ogg' : 'application/octet-stream'),
                size: msg._data?.size || 0,
                mentions: mentions
            }
        });

        // Auto-read mensagens
        if (configData.opt_read_msg) {
            try {
                const chat = await msg.getChat();
                await chat.sendSeen();
            } catch(e) {}
        }
    });

    client.on('message_create', async (msg) => {
        // Ignora as que recebemos (já tratadas acima)
        if (!msg.fromMe) return;

        // Propaga evento SSE de mensagem enviada (por nós) com mapeamento robusto
        let senderName = null;
        const senderId = msg.author || msg.from;
        try {
            const contact = await msg.getContact();
            senderName = contact.name || contact.pushname || contact.verifiedName || senderId.split('@')[0];
        } catch (e) {
            senderName = msg._data?.notifyName || msg._data?.pushname || senderId.split('@')[0];
        }

        let mentions = {};
        if (msg.mentionedIds && msg.mentionedIds.length > 0) {
            try {
                mentions = await getMentionsMetadata(client, msg.mentionedIds);
            } catch (e) {
                console.error('[SSE message_create mentions error]', e);
            }
        }

        clientEvents.emit('message', {
            instanceId,
            msg: {
                id: msg.id.id,
                body: msg.body,
                type: msg.type,
                timestamp: msg.timestamp,
                fromMe: msg.fromMe,
                from: msg.from,
                to: msg.to,
                sender: senderId,
                senderName: senderName,
                hasMedia: msg.hasMedia,
                mimetype: msg._data?.mimetype || msg.mimetype || (msg.type === 'image' ? 'image/jpeg' : msg.type === 'video' ? 'video/mp4' : msg.type === 'audio' || msg.type === 'ptt' ? 'audio/ogg' : 'application/octet-stream'),
                size: msg._data?.size || 0,
                mentions: mentions
            }
        });

        // Ao Enviar (Só dispara se notify_own_msg for ativado)
        if (configData.notify_own_msg) {
            const payload = { event: 'message_sent', instance: instanceId, msg };
            fireWebhook(configData.wh_message_out, payload);
        }
    });

    client.on('message_revoke_everyone', async (after, before) => {
        const senderId = after.author || after.from;
        let senderName = null;
        try {
            const contact = await after.getContact();
            senderName = contact.name || contact.pushname || contact.verifiedName || senderId.split('@')[0];
        } catch (e) {
            senderName = after._data?.notifyName || after._data?.pushname || senderId.split('@')[0];
        }

        clientEvents.emit('message', {
            instanceId,
            msg: {
                id: after.id.id,
                body: '',
                type: 'revoked',
                timestamp: after.timestamp,
                fromMe: after.fromMe,
                from: after.from,
                to: after.to,
                sender: senderId,
                senderName: senderName,
                hasMedia: false,
                mimetype: 'application/octet-stream',
                size: 0
            }
        });
    });

    client.on('message_revoke_me', async (msg) => {
        const senderId = msg.author || msg.from;
        let senderName = null;
        try {
            const contact = await msg.getContact();
            senderName = contact.name || contact.pushname || contact.verifiedName || senderId.split('@')[0];
        } catch (e) {
            senderName = msg._data?.notifyName || msg._data?.pushname || senderId.split('@')[0];
        }

        clientEvents.emit('message', {
            instanceId,
            msg: {
                id: msg.id.id,
                body: '',
                type: 'revoked',
                timestamp: msg.timestamp,
                fromMe: msg.fromMe,
                from: msg.from,
                to: msg.to,
                sender: senderId,
                senderName: senderName,
                hasMedia: false,
                mimetype: 'application/octet-stream',
                size: 0
            }
        });
    });

    client.on('call', async (call) => {
        // Rejeitar chamadas automático
        if (configData.opt_reject_call) {
            try {
                await call.reject();
                console.log(`[${instanceId}] Chamada de ${call.from} rejeitada automaticamente.`);
            } catch(e) {}
        }
    });

    client.initialize().catch(err => {
        console.error(`[${instanceId}] Erro ao inicializar:`, err);
        instanceData.status = 'ERROR';
    });

    return instanceData;
}

async function restoreSessions() {
    try {
        const rows = await db.getInstances();
        console.log(`[Sistema] Encontradas ${rows.length} instâncias no Banco de Dados.`);
        for (const row of rows) {
            try {
                console.log(`[Sistema] Iniciando restauração: ${row.id}`);
                await createInstance(row);
            } catch (instErr) {
                console.error(`[Sistema] Erro ao restaurar instância ${row.id}:`, instErr);
            }
        }
        console.log('✅ Tudo pronto!');
    } catch (error) {
        console.error("Erro ao ler banco de dados:", error);
    }
}

async function deleteInstance(instanceId) {
    const instance = instances.get(instanceId);
    if (!instance) return false;

    if (instance.client) {
        try { await instance.client.destroy(); } catch (e) {}
    }
    instances.delete(instanceId);
    await db.deleteInstanceDb(instanceId);

    const folderPath = path.join(__dirname, '.wwebjs_auth', `session-${instanceId}`);
    try {
        if (fs.existsSync(folderPath)) {
            fs.rmSync(folderPath, { recursive: true, force: true });
        }
    } catch (e) {}
    
    return true;
}

async function disconnectInstance(instanceId) {
    const instance = instances.get(instanceId);
    if (!instance) return false;

    if (instance.client) {
        try {
            console.log(`[${instanceId}] Encerrando cliente Puppeteer...`);
            // Se o status for ERROR, o logout trava. Pulamos direto pro destroy.
            if (instance.status !== 'ERROR') {
                const logoutPromise = instance.client.logout();
                const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout no logout')), 5000));
                await Promise.race([logoutPromise, timeoutPromise]);
            }
        } catch (e) {
            console.log(`[${instanceId}] Erro/Timeout no logout normal, forçando encerramento.`);
        }
        try {
            await instance.client.destroy();
            console.log(`[${instanceId}] Cliente destruído com sucesso.`);
        } catch (e) {}
    }
    
    instances.delete(instanceId);

    const safeClientId = String(instanceId).replace(/[^a-zA-Z0-9_-]/g, '_');
    const folderPath = path.join(__dirname, '.wwebjs_auth', `session-${safeClientId}`);
    try {
        if (fs.existsSync(folderPath)) {
            const fsPromise = require('fs/promises');
            // Tenta forçar a exclusão com retry em caso de lock temporário do Windows
            await fsPromise.rm(folderPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 1000 });
            console.log(`[${instanceId}] Pasta de sessão removida com sucesso.`);
        }
    } catch (e) {
        console.warn(`[${instanceId}] Aviso: Não foi possível deletar a pasta de sessão:`, e.message);
    }

    const rows = await db.getInstances();
    const row = rows.find(r => r.id === instanceId);
    if (row) {
        console.log(`[${instanceId}] Reiniciando a instância...`);
        await createInstance(row);
    }

    return true;
}

async function updateInstanceConfig(configData) {
    await db.saveInstance(configData);
    const instance = instances.get(configData.id);
    if (instance) {
        Object.assign(instance, configData);
    }
}

async function destroyAllInstances() {
    console.log('[Sistema] Finalizando todas as instâncias do WhatsApp de forma limpa...');
    for (const [id, instance] of instances.entries()) {
        if (instance.client) {
            try {
                console.log(`[Sistema] Fechando Puppeteer para a instância: ${id}`);
                await instance.client.destroy();
            } catch (e) {
                console.error(`[Sistema] Erro ao fechar cliente da instância ${id}:`, e.message);
            }
        }
    }
    instances.clear();
}

async function getMentionsMetadata(client, mentionedIds) {
    const mentions = {};
    if (!mentionedIds || !Array.isArray(mentionedIds) || mentionedIds.length === 0) {
        return mentions;
    }
    
    for (const jid of mentionedIds) {
        try {
            const userPart = jid.split('@')[0];
            const contact = await client.getContactById(jid);
            if (contact) {
                mentions[userPart] = {
                    name: contact.name || null,
                    pushname: contact.pushname || null,
                    number: contact.number || null
                };
            } else {
                mentions[userPart] = {
                    name: null,
                    pushname: null,
                    number: null
                };
            }
        } catch (e) {
            console.error(`[Mentions Resolver Error] For JID ${jid}:`, e.message);
            const userPart = jid.split('@')[0];
            mentions[userPart] = {
                name: null,
                pushname: null,
                number: null
            };
        }
    }
    return mentions;
}

module.exports = {
    instances,
    createInstance,
    updateInstanceConfig,
    restoreSessions,
    deleteInstance,
    disconnectInstance,
    destroyAllInstances,
    clientEvents,
    addMessageLog,
    MessageMedia,
    getMentionsMetadata
};
