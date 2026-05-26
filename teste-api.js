const axios = require('axios');

async function testarAPI() {
    // Substitua pelo número que vai RECEBER a mensagem (com DDD)
    const numeroDestino = "5511950345277"; 
    
    try {
        console.log(`Enviando mensagem para ${numeroDestino}...`);
        
        const response = await axios.post('http://localhost:3000/send-message', {
            number: numeroDestino,
            message: "Olá! Esta é uma mensagem de teste enviada pela minha nova API local! 🚀"
        });

        console.log("✅ Sucesso!", response.data);
    } catch (error) {
        console.error("❌ Erro ao enviar:", error.response ? error.response.data : error.message);
    }
}

testarAPI();
