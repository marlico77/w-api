const express = require('express');
const { instances, createInstance, updateInstanceConfig, deleteInstance, disconnectInstance, addMessageLog, MessageMedia } = require('./whatsappClient');
const axios = require('axios');

const router = express.Router();

// ==========================
// ROTAS DE GERENCIAMENTO (INSTÂNCIAS)
// ==========================

// Listar todas as instâncias
router.get('/api/instances', (req, res) => {
    const list = [];
    for (const [id, data] of instances.entries()) {
        list.push({
            id: id,
            status: data.status,
            token: data.token,
            createdAt: data.createdAt
        });
    }
    res.json(list);
});

// Criar ou atualizar instância (recebe os dados do form)
router.post('/api/instances', async (req, res) => {
    const configData = req.body;
    if (!configData.id) return res.status(400).json({ error: 'Nome da instância é obrigatório' });
    
    try {
        const rows = await db.getInstances();
        const existing = rows.find(r => r.id === configData.id);
        
        if (existing) {
            configData.createdAt = existing.createdAt;
            if (!configData.token) configData.token = existing.token;
            
            await updateInstanceConfig(configData);
            return res.json({ success: true, instance: { id: configData.id, status: instances.get(configData.id).status, token: configData.token } });
        } else {
            if (!configData.token) {
                configData.token = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
            }
            configData.createdAt = new Date().toLocaleString('pt-BR'); // Agora com data e hora
            
            const data = await createInstance(configData);
            return res.json({ success: true, instance: { id: data.id, status: data.status, token: data.token } });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Deletar instância
router.delete('/api/instances/:id', async (req, res) => {
    const success = await deleteInstance(req.params.id);
    if (success) {
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Instância não encontrada' });
    }
});

// ==========================
// ROTAS DO PAINEL WEB (DASHBOARD DA INSTÂNCIA)
// ==========================

router.get('/api/instances/:id/status', (req, res) => {
    const instance = instances.get(req.params.id);
    if (!instance) return res.status(404).json({ error: 'Not found' });

    res.json({
        status: instance.status,
        qrCode: instance.qrCode
    });
});

const db = require('./database');
router.get('/api/instances/:id/config', async (req, res) => {
    try {
        const rows = await db.getInstances();
        const config = rows.find(r => r.id === req.params.id);
        if (!config) return res.status(404).json({ error: 'Configuração não encontrada' });
        res.json(config);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar configuração' });
    }
});

router.get('/api/instances/:id/messages', (req, res) => {
    const instance = instances.get(req.params.id);
    if (!instance) return res.status(404).json({ error: 'Not found' });
    res.json(instance.messages);
});

router.post('/api/instances/:id/disconnect', async (req, res) => {
    try {
        const success = await disconnectInstance(req.params.id);
        if (!success) return res.status(404).json({ error: 'Instância não encontrada' });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao desconectar: ' + error.message });
    }
});

// ==========================
// ROTAS DA API (SEND)
// ==========================

// Middleware para verificar se a instância está conectada
const checkInstanceReady = (req, res, next) => {
    const instance = instances.get(req.params.id);
    if (!instance) return res.status(404).json({ error: 'Instância não encontrada' });
    
    // Lógica da Configuração Geral (Desabilitar Enfileiramento)
    if (instance.opt_disable_queue && instance.status !== 'CONNECTED') {
        return res.status(503).json({ error: 'Envio rejeitado: Cliente offline e o enfileiramento está desabilitado.' });
    }
    
    // Se o enfileiramento não estiver desabilitado, deixamos a msg passar para o whatsapp-web.js (que tentará enfileirar)
    
    req.waInstance = instance;
    next();
};

const formatNumber = (number) => {
    if (!number.includes('@c.us') && !number.includes('@g.us')) {
        return `${number}@c.us`;
    }
    return number;
};

// Enviar Mensagem
router.post('/api/instances/:id/send-message', checkInstanceReady, async (req, res) => {
    const { number, message } = req.body;
    if (!number || !message) return res.status(400).json({ error: 'Parâmetros "number" e "message" obrigatórios.' });

    try {
        const formattedNumber = formatNumber(number);
        const response = await req.waInstance.client.sendMessage(formattedNumber, message);
        
        addMessageLog(req.params.id, {
            id: response.id.id,
            from: 'API (Você)',
            to: formattedNumber,
            body: message,
            timestamp: Math.floor(Date.now() / 1000),
            hasMedia: false,
            type: 'chat',
            direction: 'OUT'
        });

        res.status(200).json({ success: true, messageId: response.id.id });
    } catch (error) {
        res.status(500).json({ error: 'Falha ao enviar mensagem', details: error.message });
    }
});

// Enviar Mídia
router.post('/api/instances/:id/send-media', checkInstanceReady, async (req, res) => {
    const { number, caption, url, base64, mimetype, filename } = req.body;
    if (!number) return res.status(400).json({ error: 'Parâmetro "number" é obrigatório.' });

    try {
        const formattedNumber = formatNumber(number);
        let media;
        if (url) {
            const response = await axios.get(url, { responseType: 'arraybuffer' });
            media = new MessageMedia(response.headers['content-type'], Buffer.from(response.data, 'binary').toString('base64'), filename || 'file');
        } else if (base64 && mimetype) {
            media = new MessageMedia(mimetype, base64, filename || 'file');
        } else {
            return res.status(400).json({ error: 'Forneça "url" OU "base64" + "mimetype".' });
        }

        const response = await req.waInstance.client.sendMessage(formattedNumber, media, { caption });
        
        addMessageLog(req.params.id, {
            id: response.id.id,
            from: 'API (Você)',
            to: formattedNumber,
            body: caption || '[Mídia]',
            timestamp: Math.floor(Date.now() / 1000),
            hasMedia: true,
            type: 'media',
            direction: 'OUT'
        });

        res.status(200).json({ success: true, messageId: response.id.id });
    } catch (error) {
        res.status(500).json({ error: 'Falha ao enviar mídia', details: error.message });
    }
});

// Gerenciador de sincronização em segundo plano
const syncJobs = {}; // Formato: { [instanceId]: { status: 'syncing'|'done', progress: 0, contacts: [] } }

// Iniciar a sincronização de contatos em Background
router.post('/api/instances/:id/sync-contacts', async (req, res) => {
    const id = req.params.id;
    const instance = instances.get(id);
    if (!instance || instance.status !== 'CONNECTED') {
        return res.status(400).send('Instância não conectada.');
    }

    if (syncJobs[id] && syncJobs[id].status === 'syncing') {
        return res.json({ success: true, message: 'Já existe uma sincronização em andamento' });
    }

    // Inicializa a tarefa
    syncJobs[id] = { status: 'syncing', progress: 0, contacts: [] };
    res.json({ success: true, message: 'Sincronização iniciada' });

    // Simulador de progresso (aumenta gradativamente até 95%)
    const simInterval = setInterval(() => {
        if (syncJobs[id] && syncJobs[id].status === 'syncing') {
            if (syncJobs[id].progress < 95) {
                syncJobs[id].progress += Math.floor(Math.random() * 10) + 1; // 1 a 10%
                if (syncJobs[id].progress > 95) syncJobs[id].progress = 95;
            }
        }
    }, 1500);

    try {
        // Tenta baixar os contatos via WWebJS
        const contacts = await instance.client.getContacts();
        const mapped = [];
        for (const c of contacts) {
            if (!c || !c.id) continue;
            mapped.push({
                number: c.id.user || '',
                name: c.name || c.pushname || c.shortName || c.number || c.id.user,
                isGroup: c.isGroup || false
            });
        }
        clearInterval(simInterval);
        syncJobs[id] = { status: 'done', progress: 100, contacts: mapped };
    } catch (e) {
        clearInterval(simInterval);
        console.error('Erro ao buscar contatos:', e);
        syncJobs[id] = { status: 'error', progress: 0, contacts: [], error: 'Falha ao baixar contatos do aparelho.' };
    }
});

// Verificar status e puxar os contatos baixados
router.get('/api/instances/:id/raw-contacts', (req, res) => {
    const id = req.params.id;
    const job = syncJobs[id];
    
    if (!job) {
        return res.status(404).json({ error: 'Nenhuma sincronização iniciada ou encontrada' });
    }

    if (job.status === 'error') {
        return res.status(500).json({ error: job.error });
    }

    res.json({
        status: job.status,
        progress: job.progress,
        contacts: job.status === 'done' ? job.contacts : []
    });
});

// Salvar contatos escolhidos no Banco
router.post('/api/instances/:id/contacts', async (req, res) => {
    try {
        const contactsList = req.body.contacts; // Array de objetos { number, name, isGroup }
        await db.saveContacts(req.params.id, contactsList);
        res.json({ success: true, count: contactsList.length });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Listar contatos SALVOS no banco para uma instância
router.get('/api/instances/:id/contacts', async (req, res) => {
    try {
        const rows = await db.getContacts(req.params.id);
        res.json(rows);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Criar Campanha
router.post('/api/campaigns', async (req, res) => {
    const { instanceId, name, message, scheduledAt, contacts, recurrence } = req.body;
    if (!instanceId || !message || !scheduledAt || !contacts || !contacts.length) {
        return res.status(400).json({ error: 'Dados incompletos' });
    }
    
    try {
        const campaignId = await db.createCampaign(instanceId, name, message, scheduledAt, contacts, recurrence);
        res.json({ success: true, campaignId });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Editar Campanha
router.put('/api/campaigns/:id', async (req, res) => {
    const campaignId = req.params.id;
    const { name, message, scheduledAt, contacts, recurrence } = req.body;
    
    if (!message || !scheduledAt || !contacts || !contacts.length) {
        return res.status(400).json({ error: 'Dados incompletos' });
    }
    
    try {
        await db.editCampaign(campaignId, name, message, scheduledAt, recurrence, contacts);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Obter contatos de uma campanha específica
router.get('/api/campaigns/:id/contacts', async (req, res) => {
    try {
        const contacts = await db.getCampaignContacts(req.params.id);
        res.json(contacts);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Listar Campanhas
router.get('/api/campaigns', async (req, res) => {
    try {
        const rows = await db.getCampaigns();
        const campaigns = rows.map(r => {
            let parsedDays = [];
            let parsedTimes = [];
            try { if (r.recurrence_days) parsedDays = JSON.parse(r.recurrence_days); } catch(e){}
            try { if (r.recurrence_times) parsedTimes = JSON.parse(r.recurrence_times); } catch(e){}
            return {
                ...r,
                recurrence_days: parsedDays,
                recurrence_times: parsedTimes
            };
        });
        res.json(campaigns);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ==========================
// PROJETOS & CHAVES DE API
// ==========================

router.get('/api/projects', async (req, res) => {
    try {
        const projects = await db.getProjects();
        res.json(projects);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/api/projects', async (req, res) => {
    const { name, website, instanceId } = req.body;
    if (!name) return res.status(400).json({ error: 'Nome do projeto é obrigatório' });
    if (!instanceId) return res.status(400).json({ error: 'Instância é obrigatória' });
    
    try {
        const crypto = require('crypto');
        const apiKey = 'sk-live-' + crypto.randomBytes(24).toString('hex');
        const id = await db.createProject(name, website || '', apiKey, instanceId);
        res.json({ success: true, project: { id, name, website, api_key: apiKey, instance_id: instanceId } });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.delete('/api/projects/:id', async (req, res) => {
    try {
        await db.deleteProject(req.params.id);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.put('/api/projects/:id', async (req, res) => {
    const { name, website, instanceId } = req.body;
    if (!name) return res.status(400).json({ error: 'Nome do projeto é obrigatório' });
    if (!instanceId) return res.status(400).json({ error: 'Instância é obrigatória' });
    
    try {
        await db.updateProject(req.params.id, name, website || '', instanceId);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

const apiKeyMiddleware = async (req, res, next) => {
    const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
    if (!apiKey) return res.status(401).json({ error: 'Chave de API não fornecida (Header: x-api-key)' });
    
    try {
        const project = await db.validateApiKey(apiKey);
        if (!project) return res.status(403).json({ error: 'Chave de API inválida' });
        
        if (req.params.id && project.instance_id !== req.params.id) {
            return res.status(403).json({ error: `Esta chave de API não tem permissão para a instância '${req.params.id}'` });
        }
        
        next();
    } catch (e) {
        res.status(500).json({ error: 'Erro ao validar chave' });
    }
};

router.post('/api/v1/instances/:id/send-text', apiKeyMiddleware, checkInstanceReady, async (req, res) => {
    const { number, message } = req.body;
    if (!number || !message) return res.status(400).json({ error: 'Parâmetros "number" e "message" são obrigatórios.' });

    try {
        const formattedNumber = formatNumber(number);
        const response = await req.waInstance.client.sendMessage(formattedNumber, message);
        res.status(200).json({ success: true, messageId: response.id.id, timestamp: new Date() });
    } catch (error) {
        res.status(500).json({ error: 'Falha ao enviar mensagem', details: error.message });
    }
});

module.exports = router;
