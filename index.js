/**
 * ZAP API - Sistema de Automação de Mensagens do WhatsApp
 * Desenvolvido por: Marlon Souza
 * Licença: Atribuição Obrigatória (Manter Créditos)
 * 
 * Assinatura: Marlon Souza © 2026
 */

const express = require('express');
const dotenv = require('dotenv');
const routes = require('./routes');
const { restoreSessions, destroyAllInstances } = require('./whatsappClient');
const { startScheduler } = require('./scheduler');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' })); 
app.use(express.static('public'));
app.use('/', routes);

const server = app.listen(PORT, () => {
    console.log(`🚀 Servidor da API rodando na porta ${PORT}`);
    
    // Restaura as sessões antigas que já estavam salvas na máquina
    console.log('🔄 Restaurando sessões do WhatsApp...');
    restoreSessions();
    
    // Inicia o motor de mensagens automáticas
    startScheduler();
});

// Função para desligamento limpo
const handleShutdown = async (signal) => {
    console.log(`\n[Sistema] Sinal de desligamento recebido (${signal}). Iniciando encerramento limpo...`);
    try {
        await destroyAllInstances();
        server.close(() => {
            console.log('[Sistema] Servidor HTTP fechado. Encerrando processo.');
            process.exit(0);
        });
    } catch (e) {
        console.error('[Sistema] Erro durante o desligamento:', e);
        process.exit(1);
    }
};

// Captura interrupções padrão
process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

// Tratamento específico para o Nodemon no Windows/Linux
process.once('SIGUSR2', async () => {
    console.log('\n[Nodemon] Reiniciando... Fechando instâncias do WhatsApp...');
    try {
        await destroyAllInstances();
    } catch (e) {
        console.error('[Nodemon] Erro no encerramento das instâncias:', e);
    }
    process.kill(process.pid, 'SIGUSR2');
});

// Captura mensagens de desligamento do processo pai (ex: nodemon no Windows)
process.on('message', async (msg) => {
    if (msg === 'shutdown') {
        console.log('[Windows/Nodemon] Recebida mensagem de desligamento.');
        await destroyAllInstances();
        process.exit(0);
    }
});
