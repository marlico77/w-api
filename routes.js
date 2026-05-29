/**
 * SAPI API - Rotas e Controladores da API
 * Desenvolvido por: Marlon Souza
 * Licença: Atribuição Obrigatória (Manter Créditos)
 * 
 * Assinatura: Marlon Souza © 2026
 */

const express = require('express');
const { instances, createInstance, updateInstanceConfig, deleteInstance, disconnectInstance, clientEvents, addMessageLog, MessageMedia, getMentionsMetadata } = require('./whatsappClient');
const axios = require('axios');
const db = require('./database');
const crypto = require('crypto');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

function generateToken(username, role) {
    const payload = JSON.stringify({ username, role, expires: Date.now() + 24 * 60 * 60 * 1000 });
    const signature = crypto.createHmac('sha256', JWT_SECRET).update(payload).digest('hex');
    return Buffer.from(payload).toString('base64') + '.' + signature;
}

function verifyToken(token) {
    try {
        const [payloadB64, signature] = token.split('.');
        const payloadStr = Buffer.from(payloadB64, 'base64').toString('utf8');
        const payload = JSON.parse(payloadStr);
        
        const expectedSignature = crypto.createHmac('sha256', JWT_SECRET).update(payloadStr).digest('hex');
        if (signature !== expectedSignature) return null;
        
        if (Date.now() > payload.expires) return null;
        
        return payload;
    } catch (e) {
        return null;
    }
}

const authMiddleware = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    let token = authHeader && authHeader.split(' ')[1];
    
    if (!token && req.query.token) {
        token = req.query.token;
    }
    
    if (!token) {
        return res.status(401).json({ error: 'Acesso negado: Token não fornecido.' });
    }
    
    const decoded = verifyToken(token);
    if (!decoded) {
        return res.status(401).json({ error: 'Sessão expirada ou token inválido.' });
    }
    
    req.user = decoded;
    next();
};

const checkInstanceOwnership = (req, res, next) => {
    const id = req.params.id;
    const instance = instances.get(id);
    if (!instance) return res.status(404).json({ error: 'Instância não encontrada' });
    
    if (req.user && req.user.role !== 'ADMINISTRADOR' && instance.created_by !== req.user.username) {
        return res.status(403).json({ error: 'Acesso negado. Você não tem permissão para acessar esta instância.' });
    }
    
    next();
};

// Rota pública de login
router.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Usuário e senha são obrigatórios.' });
    }
    
    try {
        const user = await db.validateUser(username, password);
        if (!user) {
            return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
        }
        
        const token = generateToken(user.username, user.role);
        res.json({ success: true, token, user: { username: user.username, role: user.role } });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/api/auth/register', async (req, res) => {
    const { fullName, cpf, address, email, username, password, googleId } = req.body;
    
    if (!fullName || !cpf || !address || !email || !username) {
        return res.status(400).json({ error: 'Todos os campos obrigatórios devem ser informados.' });
    }
    
    try {
        const userExists = await db.checkUsernameExists(username);
        if (userExists) {
            return res.status(400).json({ error: 'Este nome de usuário já está em uso.' });
        }
        
        const emailExists = await db.checkEmailExists(email);
        if (emailExists) {
            return res.status(400).json({ error: 'Este e-mail já está cadastrado.' });
        }
        
        await db.createUser(fullName, cpf, address, email, username, password, googleId);
        res.status(201).json({ success: true, message: 'Usuário cadastrado com sucesso.' });
    } catch (e) {
        res.status(500).json({ error: 'Erro ao cadastrar usuário', details: e.message });
    }
});

router.get('/api/auth/check-username', async (req, res) => {
    const { username } = req.query;
    if (!username) return res.status(400).json({ error: 'username é obrigatório.' });
    
    try {
        const exists = await db.checkUsernameExists(username);
        res.json({ exists });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/api/auth/google', async (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token do Google é obrigatório.' });
    
    try {
        const response = await axios.get(`https://oauth2.googleapis.com/tokeninfo?id_token=${token}`);
        const payload = response.data;
        
        const googleId = payload.sub;
        const email = payload.email;
        const name = payload.name;
        
        let user = await db.getUserByGoogleId(googleId);
        if (!user && email) {
            user = await db.getUserByEmail(email);
            if (user) {
                await db.linkGoogleId(user.username, googleId);
                user.google_id = googleId;
            }
        }
        
        if (user) {
            const jwtToken = generateToken(user.username, user.role);
            return res.json({ 
                success: true, 
                token: jwtToken, 
                user: { username: user.username, role: user.role } 
            });
        } else {
            return res.json({
                success: false,
                requiresRegistration: true,
                googleData: {
                    googleId,
                    email,
                    name
                }
            });
        }
    } catch (error) {
        console.error('[Google Auth Error]', error.message);
        res.status(401).json({ error: 'Falha na autenticação com o Google.', details: error.message });
    }
});

router.get('/api/auth/google-client-id', (req, res) => {
    res.json({ clientId: process.env.GOOGLE_CLIENT_ID || null });
});


router.get('/api/auth/me', authMiddleware, (req, res) => {
    res.json({ success: true, user: { username: req.user.username, role: req.user.role } });
});

// Middleware para proteger as outras rotas /api (mas não /api/v1)
router.use('/api', (req, res, next) => {
    if (req.path.startsWith('/v1/')) {
        return next();
    }
    authMiddleware(req, res, next);
});

// Middleware de autorização para administradores
const adminMiddleware = (req, res, next) => {
    if (!req.user || req.user.role !== 'ADMINISTRADOR') {
        return res.status(403).json({ error: 'Acesso negado: Administradores apenas.' });
    }
    next();
};

// Rotas administrativas de gestão de usuários
router.get('/api/users', adminMiddleware, async (req, res) => {
    try {
        const users = await db.getUsers();
        res.json(users);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.put('/api/users/:username/role', adminMiddleware, async (req, res) => {
    const { username } = req.params;
    const { role } = req.body;
    if (!role || !['ADMINISTRADOR', 'USUARIO'].includes(role)) {
        return res.status(400).json({ error: 'Papel inválido. Escolha ADMINISTRADOR ou USUARIO.' });
    }
    if (username === 'ADMINISTRADOR') {
        return res.status(400).json({ error: 'Não é possível alterar o cargo do administrador padrão.' });
    }
    try {
        await db.updateUserRole(username, role);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.delete('/api/users/:username', adminMiddleware, async (req, res) => {
    const { username } = req.params;
    if (username === 'ADMINISTRADOR') {
        return res.status(400).json({ error: 'Não é possível remover o administrador padrão.' });
    }
    if (username === req.user.username) {
        return res.status(400).json({ error: 'Você não pode se excluir.' });
    }
    try {
        await db.deleteUser(username);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ==========================
// ROTAS DE GERENCIAMENTO (INSTÂNCIAS)
// ==========================

// Listar todas as instâncias
router.get('/api/instances', (req, res) => {
    const list = [];
    for (const [id, data] of instances.entries()) {
        if (req.user.role === 'ADMINISTRADOR' || data.created_by === req.user.username) {
            list.push({
                id: id,
                status: data.status,
                token: data.token,
                createdAt: data.createdAt,
                created_by: data.created_by
            });
        }
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
            if (req.user.role !== 'ADMINISTRADOR' && existing.created_by !== req.user.username) {
                return res.status(403).json({ error: 'Você não tem permissão para editar esta instância.' });
            }
            configData.createdAt = existing.createdAt;
            configData.created_by = existing.created_by;
            if (!configData.token) configData.token = existing.token;
            
            await updateInstanceConfig(configData);
            return res.json({ success: true, instance: { id: configData.id, status: instances.get(configData.id).status, token: configData.token } });
        } else {
            if (!configData.token) {
                configData.token = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
            }
            configData.createdAt = new Date().toLocaleString('pt-BR');
            configData.created_by = req.user.username;
            
            const data = await createInstance(configData);
            return res.json({ success: true, instance: { id: data.id, status: data.status, token: data.token } });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Deletar instância
router.delete('/api/instances/:id', checkInstanceOwnership, async (req, res) => {
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

router.get('/api/instances/:id/status', checkInstanceOwnership, (req, res) => {
    const instance = instances.get(req.params.id);
    if (!instance) return res.status(404).json({ error: 'Not found' });

    res.json({
        status: instance.status,
        qrCode: instance.qrCode
    });
});

router.get('/api/instances/:id/config', checkInstanceOwnership, async (req, res) => {
    try {
        const rows = await db.getInstances();
        const config = rows.find(r => r.id === req.params.id);
        if (!config) return res.status(404).json({ error: 'Configuração não encontrada' });
        res.json(config);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar configuração' });
    }
});

router.get('/api/instances/:id/messages', checkInstanceOwnership, (req, res) => {
    const instance = instances.get(req.params.id);
    if (!instance) return res.status(404).json({ error: 'Not found' });
    res.json(instance.messages);
});

router.post('/api/instances/:id/disconnect', checkInstanceOwnership, async (req, res) => {
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
    const id = req.params.id || req.body.instanceId;
    const instance = instances.get(id);
    if (!instance) return res.status(404).json({ error: 'Instância não encontrada' });
    
    // Bloqueia acesso a instâncias de terceiros para usuários não-administradores em requisições do painel
    if (req.user && req.user.role !== 'ADMINISTRADOR' && instance.created_by !== req.user.username) {
        return res.status(403).json({ error: 'Acesso negado. Você não é dono desta instância.' });
    }
    
    // Lógica da Configuração Geral (Desabilitar Enfileiramento)
    if (instance.opt_disable_queue && instance.status !== 'CONNECTED') {
        return res.status(503).json({ error: 'Envio rejeitado: Cliente offline e o enfileiramento está desabilitado.' });
    }
    
    // Se o enfileiramento não estiver desabilitado, deixamos a msg passar para o whatsapp-web.js (que tentará enfileirar)
    
    req.waInstance = instance;
    next();
};

const formatNumber = (number) => {
    if (!number.includes('@')) {
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
        console.error('[API Send Message Error]', error);
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
        console.error('[API Send Media Error]', error);
        res.status(500).json({ error: 'Falha ao enviar mídia', details: error.message });
    }
});

// Apagar (Revogar) Mensagem para todos
router.delete('/api/instances/:id/chats/:chatId/messages/:messageId', checkInstanceReady, async (req, res) => {
    const { chatId, messageId } = req.params;
    try {
        const chat = await req.waInstance.client.getChatById(chatId);
        const messages = await chat.fetchMessages({ limit: 50 });
        const message = messages.find(m => m.id.id === messageId);
        
        if (!message) {
            return res.status(404).json({ error: 'Mensagem não encontrada no histórico recente.' });
        }
        
        await message.delete(true); // true = apagar para todos
        res.status(200).json({ success: true });
    } catch (error) {
        console.error('[API Delete Message Error]', error);
        res.status(500).json({ error: 'Falha ao apagar mensagem', details: error.message });
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
    
    // Verifica posse da instância
    const instance = instances.get(instanceId);
    if (!instance) return res.status(404).json({ error: 'Instância não encontrada' });
    if (req.user.role !== 'ADMINISTRADOR' && instance.created_by !== req.user.username) {
        return res.status(403).json({ error: 'Acesso negado. Você não é o proprietário desta instância.' });
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
        const campaigns = await db.getCampaigns(req.user.username, req.user.role);
        const campaign = campaigns.find(c => String(c.id) === String(campaignId));
        if (!campaign) return res.status(403).json({ error: 'Acesso negado ou campanha não encontrada.' });
        
        await db.editCampaign(campaignId, name, message, scheduledAt, recurrence, contacts);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Obter contatos de uma campanha específica
router.get('/api/campaigns/:id/contacts', async (req, res) => {
    try {
        const campaigns = await db.getCampaigns(req.user.username, req.user.role);
        const campaign = campaigns.find(c => String(c.id) === String(req.params.id));
        if (!campaign) return res.status(403).json({ error: 'Acesso negado ou campanha não encontrada.' });

        const contacts = await db.getCampaignContacts(req.params.id);
        res.json(contacts);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Listar Campanhas
router.get('/api/campaigns', async (req, res) => {
    try {
        const rows = await db.getCampaigns(req.user.username, req.user.role);
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
        const projects = await db.getProjects(req.user.username, req.user.role);
        res.json(projects);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/api/projects', async (req, res) => {
    const { name, website, instanceId } = req.body;
    if (!name) return res.status(400).json({ error: 'Nome do projeto é obrigatório' });
    if (!instanceId) return res.status(400).json({ error: 'Instância é obrigatória' });
    
    // Verifica posse da instância
    const instance = instances.get(instanceId);
    if (!instance) return res.status(404).json({ error: 'Instância não encontrada' });
    if (req.user.role !== 'ADMINISTRADOR' && instance.created_by !== req.user.username) {
        return res.status(403).json({ error: 'Acesso negado. Você não possui permissão para esta instância.' });
    }

    try {
        const crypto = require('crypto');
        const apiKey = 'sk-live-' + crypto.randomBytes(24).toString('hex');
        const id = await db.createProject(name, website || '', apiKey, instanceId, req.user.username);
        res.json({ success: true, project: { id, name, website, api_key: apiKey, instance_id: instanceId } });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.delete('/api/projects/:id', async (req, res) => {
    try {
        const projects = await db.getProjects(req.user.username, req.user.role);
        const project = projects.find(p => String(p.id) === String(req.params.id));
        if (!project) return res.status(403).json({ error: 'Acesso negado ou projeto não encontrado.' });
        
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
        const projects = await db.getProjects(req.user.username, req.user.role);
        const project = projects.find(p => String(p.id) === String(req.params.id));
        if (!project) return res.status(403).json({ error: 'Acesso negado ou projeto não encontrado.' });
        
        const instance = instances.get(instanceId);
        if (!instance) return res.status(404).json({ error: 'Instância não encontrada' });
        if (req.user.role !== 'ADMINISTRADOR' && instance.created_by !== req.user.username) {
            return res.status(403).json({ error: 'Acesso negado. Você não possui permissão para esta instância.' });
        }

        await db.updateProject(req.params.id, name, website || '', instanceId);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/api/projects/:id/metrics', async (req, res) => {
    try {
        const projects = await db.getProjects(req.user.username, req.user.role);
        const project = projects.find(p => String(p.id) === String(req.params.id));
        if (!project) return res.status(403).json({ error: 'Acesso negado ou projeto não encontrado.' });

        const metrics = await db.getProjectMetrics(req.params.id);
        res.json({ success: true, metrics });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

const apiKeyMiddleware = async (req, res, next) => {
    const apiKey = req.headers['x-api-key'] || req.query.api_key || req.headers['authorization']?.replace('Bearer ', '');
    if (!apiKey) return res.status(401).json({ error: 'Chave de API não fornecida (Header: x-api-key ou Query: api_key)' });
    
    try {
        const project = await db.validateApiKey(apiKey);
        if (!project) return res.status(403).json({ error: 'Chave de API inválida' });
        
        if (req.params.id && project.instance_id !== req.params.id) {
            return res.status(403).json({ error: `Esta chave de API não tem permissão para a instância '${req.params.id}'` });
        }
        
        // Registrar log de acesso da API ao finalizar a resposta
        res.on('finish', () => {
            db.logApiRequest(project.id, req.path, req.method, res.statusCode);
        });

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

// Enviar Mídia V1
router.post('/api/v1/instances/:id/send-media', apiKeyMiddleware, checkInstanceReady, async (req, res) => {
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
        console.error('[API Send Media V1 Error]', error);
        res.status(500).json({ error: 'Falha ao enviar mídia', details: error.message });
    }
});

// Listar conversas V1
router.get('/api/v1/instances/:id/chats', apiKeyMiddleware, checkInstanceReady, async (req, res) => {
    try {
        const chats = await req.waInstance.client.getChats();
        const mapped = [];

        for (const chat of chats) {
            let lastMsg = null;
            if (chat.lastMessage) {
                lastMsg = {
                    body: chat.lastMessage.body,
                    fromMe: chat.lastMessage.fromMe,
                    timestamp: chat.lastMessage.timestamp,
                    type: chat.lastMessage.type
                };
            }

            let chatName = chat.name;
            if (!chat.isGroup && (!chatName || /^\d+$/.test(chatName.replace(/[\s\+\-]/g, '')))) {
                try {
                    const contact = await chat.getContact();
                    chatName = contact.name || contact.pushname || contact.verifiedName || chat.name || chat.id.user;
                } catch (e) {}
            }

            mapped.push({
                id: chat.id._serialized,
                name: chatName || chat.id.user,
                isGroup: chat.isGroup,
                unreadCount: chat.unreadCount,
                timestamp: chat.timestamp,
                lastMessage: lastMsg
            });
        }
        res.json(mapped);
    } catch (error) {
        console.error(`[Chat V1 Erro] Erro ao buscar conversas:`, error);
        res.status(500).json({ error: 'Erro ao buscar conversas', details: error.message });
    }
});

// Histórico de mensagens V1
router.get('/api/v1/instances/:id/chats/:chatId/messages', apiKeyMiddleware, checkInstanceReady, async (req, res) => {
    try {
        const chat = await req.waInstance.client.getChatById(req.params.chatId);
        const limit = parseInt(req.query.limit) || 50;
        const messages = await chat.fetchMessages({ limit });
        
        const mapped = [];
        const contactCache = {};

        for (const msg of messages) {
            const senderId = msg.author || msg.from;
            let name = null;
            
            if (senderId) {
                if (contactCache[senderId]) {
                    name = contactCache[senderId];
                } else {
                    name = msg._data?.notifyName || msg._data?.pushname;
                    if (!name) {
                        try {
                            const contact = await msg.getContact();
                            name = contact.name || contact.pushname || contact.verifiedName || senderId.split('@')[0];
                        } catch (e) {
                            name = senderId.split('@')[0];
                        }
                    }
                    contactCache[senderId] = name;
                }
            }

            mapped.push({
                id: msg.id.id,
                body: msg.body,
                type: msg.type,
                timestamp: msg.timestamp,
                fromMe: msg.fromMe,
                senderName: name,
                sender: senderId,
                hasMedia: msg.hasMedia,
                mimetype: msg._data?.mimetype || msg.mimetype || (msg.type === 'image' ? 'image/jpeg' : msg.type === 'video' ? 'video/mp4' : msg.type === 'audio' || msg.type === 'ptt' ? 'audio/ogg' : 'application/octet-stream'),
                size: msg._data?.size || 0
            });
        }
        res.json(mapped);
    } catch (error) {
        console.error(`[Chat V1 Erro] Erro ao buscar mensagens do chat:`, error);
        res.status(500).json({ error: 'Erro ao buscar mensagens', details: error.message });
    }
});

// Download de mídias V1
router.get('/api/v1/instances/:id/messages/:messageId/media', apiKeyMiddleware, checkInstanceReady, async (req, res) => {
    const { messageId } = req.params;
    const chatId = req.query.chatId;
    if (!chatId) return res.status(400).json({ error: 'Parâmetro "chatId" é obrigatório na query.' });

    try {
        const chat = await req.waInstance.client.getChatById(chatId);
        const messages = await chat.fetchMessages({ limit: 50 });
        const message = messages.find(m => m.id.id === messageId);

        if (!message || !message.hasMedia) {
            return res.status(404).json({ error: 'Mensagem de mídia não encontrada.' });
        }

        const media = await message.downloadMedia();
        if (!media) return res.status(404).json({ error: 'Falha ao carregar arquivo de mídia.' });

        const imgBuffer = Buffer.from(media.data, 'base64');
        res.writeHead(200, {
            'Content-Type': media.mimetype,
            'Content-Length': imgBuffer.length,
            'Content-Disposition': `inline; filename="${media.filename || 'file'}"`
        });
        res.end(imgBuffer);
    } catch (error) {
        console.error('[API Media V1 Error]', error);
        res.status(500).json({ error: 'Erro ao carregar mídia', details: error.message });
    }
});

// Avatar do contato V1
router.get('/api/v1/instances/:id/chats/:chatId/avatar', apiKeyMiddleware, checkInstanceReady, async (req, res) => {
    try {
        const profilePicUrl = await req.waInstance.client.getProfilePicUrl(req.params.chatId);
        if (profilePicUrl) {
            return res.redirect(profilePicUrl);
        }
        res.redirect('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%238e94a9"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg>');
    } catch (error) {
        res.redirect('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%238e94a9"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg>');
    }
});

// Marcar como Lido V1
router.post('/api/v1/instances/:id/chats/:chatId/seen', apiKeyMiddleware, checkInstanceReady, async (req, res) => {
    try {
        const chat = await req.waInstance.client.getChatById(req.params.chatId);
        await chat.sendSeen();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao marcar visualização', details: error.message });
    }
});

// Apagar Mensagem V1
router.delete('/api/v1/instances/:id/chats/:chatId/messages/:messageId', apiKeyMiddleware, checkInstanceReady, async (req, res) => {
    const { chatId, messageId } = req.params;
    try {
        const chat = await req.waInstance.client.getChatById(chatId);
        const messages = await chat.fetchMessages({ limit: 50 });
        const message = messages.find(m => m.id.id === messageId);
        
        if (!message) {
            return res.status(404).json({ error: 'Mensagem não encontrada no histórico recente.' });
        }
        
        await message.delete(true);
        res.status(200).json({ success: true });
    } catch (error) {
        console.error('[API Delete Message V1 Error]', error);
        res.status(500).json({ error: 'Falha ao apagar mensagem', details: error.message });
    }
});

// SSE em tempo real V1
router.get('/api/v1/instances/:id/chat-sse', apiKeyMiddleware, (req, res) => {
    const instanceId = req.params.id;
    const instance = instances.get(instanceId);
    if (!instance) return res.status(404).json({ error: 'Instância não encontrada' });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    if (!sseClients.has(instanceId)) {
        sseClients.set(instanceId, new Set());
    }
    const clients = sseClients.get(instanceId);
    clients.add(res);

    res.write(`data: ${JSON.stringify({ type: 'connected', instanceId })}\n\n`);

    req.on('close', () => {
        clients.delete(res);
        if (clients.size === 0) {
            sseClients.delete(instanceId);
        }
    });
});

// ==========================
// ROTAS DO PAINEL DE CHAT INTEGRADO
// ==========================

const sseClients = new Map(); // instanceId -> Set de res

// Registra ouvintes para disparar eventos real-time para as conexões SSE
clientEvents.on('message', ({ instanceId, msg }) => {
    const clients = sseClients.get(instanceId);
    if (clients) {
        for (const res of clients) {
            try {
                res.write(`data: ${JSON.stringify({ type: 'message', message: msg })}\n\n`);
            } catch (e) {}
        }
    }
});

clientEvents.on('ready', ({ instanceId }) => {
    const clients = sseClients.get(instanceId);
    if (clients) {
        for (const res of clients) {
            try {
                res.write(`data: ${JSON.stringify({ type: 'ready' })}\n\n`);
            } catch (e) {}
        }
    }
});

clientEvents.on('disconnected', ({ instanceId }) => {
    const clients = sseClients.get(instanceId);
    if (clients) {
        for (const res of clients) {
            try {
                res.write(`data: ${JSON.stringify({ type: 'disconnected' })}\n\n`);
            } catch (e) {}
        }
    }
});

clientEvents.on('qr', ({ instanceId, qr }) => {
    const clients = sseClients.get(instanceId);
    if (clients) {
        for (const res of clients) {
            try {
                res.write(`data: ${JSON.stringify({ type: 'qr', qr })}\n\n`);
            } catch (e) {}
        }
    }
});

// SSE endpoint para atualizações do chat em tempo real
router.get('/api/instances/:id/chat-sse', (req, res) => {
    const instanceId = req.params.id;
    const instance = instances.get(instanceId);
    if (!instance) return res.status(404).json({ error: 'Instância não encontrada' });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    if (!sseClients.has(instanceId)) {
        sseClients.set(instanceId, new Set());
    }
    const clients = sseClients.get(instanceId);
    clients.add(res);

    // Enviar mensagem de ping inicial para estabelecer a conexão
    res.write(`data: ${JSON.stringify({ type: 'connected', instanceId })}\n\n`);

    req.on('close', () => {
        clients.delete(res);
        if (clients.size === 0) {
            sseClients.delete(instanceId);
        }
    });
});

// Listar conversas (chats) ativas no aparelho
router.get('/api/instances/:id/chats', checkInstanceReady, async (req, res) => {
    try {
        const chats = await req.waInstance.client.getChats();
        const mapped = [];

        for (const chat of chats) {
            let lastMsg = null;
            if (chat.lastMessage) {
                lastMsg = {
                    body: chat.lastMessage.body,
                    fromMe: chat.lastMessage.fromMe,
                    timestamp: chat.lastMessage.timestamp,
                    type: chat.lastMessage.type
                };
            }

            let chatName = chat.name;
            // Se o chat for individual e o nome contiver apenas números (não salvo), tenta obter o pushname no WhatsApp
            if (!chat.isGroup && (!chatName || /^\d+$/.test(chatName.replace(/[\s\+\-]/g, '')))) {
                try {
                    const contact = await chat.getContact();
                    chatName = contact.name || contact.pushname || contact.verifiedName || chat.name || chat.id.user;
                } catch (e) {}
            }

            mapped.push({
                id: chat.id._serialized,
                name: chatName || chat.id.user,
                isGroup: chat.isGroup,
                unreadCount: chat.unreadCount,
                timestamp: chat.timestamp,
                lastMessage: lastMsg
            });
        }

        console.log(`[Chat] Retornados ${mapped.length} chats para a instância ${req.params.id}`);
        res.json(mapped);
    } catch (error) {
        console.error(`[Chat Erro] Erro ao buscar conversas para a instância ${req.params.id}:`, error);
        res.status(500).json({ error: 'Erro ao buscar conversas', details: error.message });
    }
});

// Obter histórico de mensagens de uma conversa específica
router.get('/api/instances/:id/chats/:chatId/messages', checkInstanceReady, async (req, res) => {
    try {
        const chat = await req.waInstance.client.getChatById(req.params.chatId);
        const limit = parseInt(req.query.limit) || 50;
        const messages = await chat.fetchMessages({ limit });
        
        const contactCache = {}; // Cache local para evitar requisições repetidas ao Puppeteer

        const mappedPromises = messages.map(async (msg) => {
            const senderId = msg.author || msg.from;
            let name = null;
            
            if (senderId) {
                if (contactCache[senderId]) {
                    name = contactCache[senderId];
                } else {
                    // Tenta ler o pushname cached no objeto de dados
                    name = msg._data?.notifyName || msg._data?.pushname;
                    
                    // Se não encontrar, tenta buscar o contato de forma rápida
                    if (!name) {
                        try {
                            const contact = await msg.getContact();
                            name = contact.name || contact.pushname || contact.verifiedName || senderId.split('@')[0];
                        } catch (e) {
                            name = senderId.split('@')[0];
                        }
                    }
                    contactCache[senderId] = name;
                }
            }

            // Resolve mentions
            let mentions = {};
            if (msg.mentionedIds && msg.mentionedIds.length > 0) {
                try {
                    mentions = await getMentionsMetadata(req.waInstance.client, msg.mentionedIds);
                } catch (e) {
                    console.error('[History mentions error]', e);
                }
            }

            return {
                id: msg.id.id,
                body: msg.body,
                type: msg.type,
                timestamp: msg.timestamp,
                fromMe: msg.fromMe,
                senderName: name,
                sender: senderId,
                hasMedia: msg.hasMedia,
                mimetype: msg._data?.mimetype || msg.mimetype || (msg.type === 'image' ? 'image/jpeg' : msg.type === 'video' ? 'video/mp4' : msg.type === 'audio' || msg.type === 'ptt' ? 'audio/ogg' : 'application/octet-stream'),
                size: msg._data?.size || 0,
                mentions: mentions
            };
        });

        const mapped = await Promise.all(mappedPromises);

        res.json(mapped);
    } catch (error) {
        console.error(`[Chat Erro] Erro ao buscar mensagens do chat ${req.params.chatId}:`, error);
        res.status(500).json({ error: 'Erro ao buscar mensagens', details: error.message });
    }
});

// Download de mídias de uma mensagem específica
router.get('/api/instances/:id/messages/:messageId/media', checkInstanceReady, async (req, res) => {
    const { chatId } = req.query;
    if (!chatId) return res.status(400).json({ error: 'Parâmetro "chatId" é obrigatório.' });

    try {
        const chat = await req.waInstance.client.getChatById(chatId);
        const messages = await chat.fetchMessages({ limit: 100 });
        const msg = messages.find(m => m.id.id === req.params.messageId);
        
        if (!msg || !msg.hasMedia) {
            return res.status(404).json({ error: 'Mensagem ou mídia não encontrada.' });
        }

        const media = await msg.downloadMedia();
        if (!media) {
            return res.status(500).json({ error: 'Falha ao baixar mídia do WhatsApp.' });
        }

        const mimetype = media.mimetype || 'application/octet-stream';
        res.setHeader('Content-Type', mimetype);
        res.setHeader('Content-Disposition', `inline; filename="${media.filename || 'file'}"`);
        res.send(Buffer.from(media.data, 'base64'));
    } catch (error) {
        res.status(500).json({ error: 'Erro ao baixar mídia', details: error.message });
    }
});

// Proxy para obter e redirecionar para a foto de perfil do contato
router.get('/api/instances/:id/chats/:chatId/avatar', checkInstanceReady, async (req, res) => {
    try {
        const url = await req.waInstance.client.getProfilePicUrl(req.params.chatId);
        if (url) {
            return res.redirect(url);
        }
        res.status(404).send('No avatar');
    } catch (e) {
        res.status(404).send('Error');
    }
});

// Obter detalhes de uma conversa específica (descrição, participantes, comunidade)
router.get('/api/instances/:id/chats/:chatId/details', checkInstanceReady, async (req, res) => {
    try {
        const chat = await req.waInstance.client.getChatById(req.params.chatId);
        
        let details = {
            id: chat.id._serialized,
            name: chat.name,
            isGroup: chat.isGroup,
            unreadCount: chat.unreadCount,
            timestamp: chat.timestamp,
            description: chat.description || '',
            participants: [],
            linkedSubgroups: [],
            parentGroupId: null
        };
        
        if (chat.isGroup) {
            // Obter participantes do grupo
            const participants = chat.participants || [];
            const mappedParticipants = await Promise.all(participants.map(async (p) => {
                let name = p.id.user;
                try {
                    const contact = await req.waInstance.client.getContactById(p.id._serialized);
                    name = contact.name || contact.pushname || contact.verifiedName || p.id.user;
                } catch (e) {}
                return {
                    id: p.id._serialized,
                    number: p.id.user,
                    name: name,
                    isAdmin: p.isAdmin,
                    isSuperAdmin: p.isSuperAdmin
                };
            }));
            details.participants = mappedParticipants;

            // Obter comunidades/subgrupos se existirem
            const communityData = await req.waInstance.client.pupPage.evaluate(async (groupId) => {
                const groupWid = window.require('WAWebWidFactory').createWid(groupId);
                const chatModel = window.require('WAWebCollections').Chat.get(groupWid);
                if (chatModel && chatModel.groupMetadata) {
                    const isParent = chatModel.groupMetadata.isParentGroup || false;
                    const linked = chatModel.groupMetadata.linkedSubgroups;
                    let list = [];
                    if (linked && typeof linked.toArray === 'function') {
                        list = linked.toArray().map(wid => wid.serialize ? wid.serialize() : wid._serialized || wid);
                    } else if (Array.isArray(linked)) {
                        list = linked.map(wid => wid._serialized || wid);
                    }
                    const parentId = chatModel.groupMetadata.parentGroupId;
                    const parentIdStr = parentId ? (parentId.serialize ? parentId.serialize() : parentId._serialized || parentId) : null;
                    
                    return { 
                        isParentGroup: isParent, 
                        linkedSubgroups: list,
                        parentGroupId: parentIdStr
                    };
                }
                return null;
            }, chat.id._serialized);

            if (communityData) {
                details.parentGroupId = communityData.parentGroupId;
                if (communityData.linkedSubgroups && communityData.linkedSubgroups.length > 0) {
                    const subgroupsList = await Promise.all(communityData.linkedSubgroups.map(async (sgId) => {
                        try {
                            const sgChat = await req.waInstance.client.getChatById(sgId);
                            return {
                                id: sgId,
                                name: sgChat.name || sgId.split('@')[0],
                                unreadCount: sgChat.unreadCount || 0
                            };
                        } catch (e) {
                            return { id: sgId, name: sgId.split('@')[0], unreadCount: 0 };
                        }
                    }));
                    details.linkedSubgroups = subgroupsList;
                }
            }
        } else {
            // Contato privado - obter descrição/status de recado do contato
            try {
                const contact = await req.waInstance.client.getContactById(chat.id._serialized);
                details.description = await contact.getAbout() || '';
            } catch (e) {}
        }
        
        res.json(details);
    } catch (error) {
        console.error(`[Chat Detalhes Erro] Erro ao buscar detalhes para a conversa ${req.params.chatId}:`, error);
        res.status(500).json({ error: 'Erro ao buscar detalhes da conversa', details: error.message });
    }
});


// Marcar conversa como visualizada/lida
router.post('/api/instances/:id/chats/:chatId/seen', checkInstanceReady, async (req, res) => {
    try {
        const chat = await req.waInstance.client.getChatById(req.params.chatId);
        await chat.sendSeen();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao marcar como lido', details: error.message });
    }
});

// Verificar se número está cadastrado no WhatsApp
router.get('/api/instances/:id/contacts/:number/registered', checkInstanceReady, async (req, res) => {
    try {
        const number = req.params.number;
        const formatted = formatNumber(number);
        const isRegistered = await req.waInstance.client.isRegisteredUser(formatted);
        res.json({ isRegistered, formatted });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao verificar contato', details: error.message });
    }
});

module.exports = router;
