const axios = require('axios');
const dotenv = require('dotenv');
const { eventListeners, addMessageLog } = require('./whatsappClient');

dotenv.config();

// Função para disparar Webhook
async function sendWebhook(instanceId, messageData) {
    const webhookUrl = process.env.WEBHOOK_URL;
    if (!webhookUrl) return;

    // Enviar o instanceId junto com os dados para o webhook saber de quem veio
    const payload = {
        instanceId: instanceId,
        ...messageData
    };

    try {
        await axios.post(webhookUrl, payload);
        console.log(`[Webhook][${instanceId}] Enviado com sucesso para ${webhookUrl}`);
    } catch (error) {
        console.error(`[Webhook][${instanceId}] Erro ao enviar:`, error.message);
    }
}

// Inscrição no evento global de mensagens
eventListeners.onMessage.push(async (instanceId, msg) => {
    try {
        console.log(`[${instanceId}] [Mensagem Recebida] de ${msg.from}: ${msg.body}`);

        const messageData = {
            id: msg.id.id,
            from: msg.from,
            to: msg.to,
            body: msg.body,
            timestamp: msg.timestamp,
            hasMedia: msg.hasMedia,
            type: msg.type,
            direction: 'IN'
        };

        // Salvar no log da memória para o Painel Web
        addMessageLog(instanceId, messageData);

        // Disparar Webhook
        await sendWebhook(instanceId, messageData);

        // Lógica interna do Bot Local
        const chat = await msg.getChat();
        
        // Bot só responde se não for grupo e se a mensagem for exata
        if (!chat.isGroup) {
            const textoMensagem = msg.body.toLowerCase();

            if (textoMensagem === 'oi' || textoMensagem === 'olá') {
                await msg.reply('Olá! Sou a instância local. Como posso ajudar?');
            }
            else if (textoMensagem === 'ping') {
                await msg.reply('pong');
            }
        }
    } catch (error) {
        console.error(`[${instanceId}] Erro ao processar mensagem recebida:`, error);
    }
});

module.exports = {}; // Executa os eventos
