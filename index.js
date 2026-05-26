const express = require('express');
const dotenv = require('dotenv');
const routes = require('./routes');
const { restoreSessions } = require('./whatsappClient');
const { startScheduler } = require('./scheduler');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' })); 
app.use(express.static('public'));
app.use('/', routes);

app.listen(PORT, () => {
    console.log(`🚀 Servidor da API rodando na porta ${PORT}`);
    
    // Restaura as sessões antigas que já estavam salvas na máquina
    console.log('🔄 Restaurando sessões do WhatsApp...');
    restoreSessions();
    
    // Inicia o motor de mensagens automáticas
    startScheduler();
});
