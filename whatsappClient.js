/**
 * ZAP API - Integração e Gerenciamento do WhatsApp Web (Puppeteer/WWebJS)
 * Desenvolvido por: Marlon Souza
 * Licença: Atribuição Obrigatória (Manter Créditos)
 * 
 * Assinatura: Marlon Souza © 2026
 */

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const axios = require('axios');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const db = require('./database');

dotenv.config();

const instances = new Map();

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

    // Limpar arquivos de trava (lock) antigos do Chromium/Puppeteer se existirem
    const sessionFolder = path.join(__dirname, '.wwebjs_auth', `session-${instanceId}`);
    const lockFiles = [
        path.join(sessionFolder, 'Default', 'LOCK'),
        path.join(sessionFolder, 'LOCK'),
        path.join(sessionFolder, 'SingletonLock'),
        path.join(sessionFolder, 'DevToolsActivePort')
    ];
    for (const file of lockFiles) {
        try {
            if (fs.existsSync(file)) {
                fs.unlinkSync(file);
                console.log(`[${instanceId}] Limpeza preventiva: Arquivo de trava removido (${path.basename(file)})`);
            }
        } catch (e) {
            // Ignora se o arquivo estiver bloqueado ou não puder ser apagado
        }
    }

    const client = new Client({
        authStrategy: new LocalAuth({ clientId: instanceId }),
        puppeteer: puppeteerOptions
    });

    instanceData.client = client;
    instances.set(instanceId, instanceData);

    client.on('qr', (qr) => {
        console.log(`[${instanceId}] Escaneie o QR Code`);
        instanceData.status = 'QR_READY';
        instanceData.qrCode = qr;
    });

    client.on('ready', () => {
        console.log(`[${instanceId}] ✅ Conectado!`);
        instanceData.status = 'CONNECTED';
        instanceData.qrCode = null;
        fireWebhook(configData.wh_connect, { event: 'connected', instance: instanceId });
    });

    client.on('disconnected', (reason) => {
        console.log(`[${instanceId}] ❌ Desconectado:`, reason);
        instanceData.status = 'DISCONNECTED';
        instanceData.qrCode = null;
        fireWebhook(configData.wh_disconnect, { event: 'disconnected', instance: instanceId, reason });
    });

    // Lógica Avançada (Z-API Features)
    client.on('message', async (msg) => {
        // Ao Receber
        const payload = { event: 'message_received', instance: instanceId, msg };
        fireWebhook(configData.wh_message_in, payload);

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

        // Ao Enviar (Só dispara se notify_own_msg for ativado)
        if (configData.notify_own_msg) {
            const payload = { event: 'message_sent', instance: instanceId, msg };
            fireWebhook(configData.wh_message_out, payload);
        }
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
            console.log(`[Sistema] Iniciando restauração: ${row.id}`);
            await createInstance(row);
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
            await instance.client.logout();
        } catch (e) {
            console.log(`[${instanceId}] Erro ao efetuar logout normal, forçando encerramento.`);
        }
        try {
            await instance.client.destroy();
        } catch (e) {}
    }
    
    instances.delete(instanceId);

    const folderPath = path.join(__dirname, '.wwebjs_auth', `session-${instanceId}`);
    try {
        if (fs.existsSync(folderPath)) {
            fs.rmSync(folderPath, { recursive: true, force: true });
        }
    } catch (e) {}

    const rows = await db.getInstances();
    const row = rows.find(r => r.id === instanceId);
    if (row) {
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

module.exports = {
    instances,
    createInstance,
    updateInstanceConfig,
    restoreSessions,
    deleteInstance,
    disconnectInstance,
    destroyAllInstances,
    addMessageLog,
    MessageMedia
};
