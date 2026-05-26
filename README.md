# ZAP API - Sistema de Automação de Mensagens do WhatsApp

O **ZAP API** é um sistema completo e de alto desempenho para gestão de múltiplas conexões de WhatsApp (Multi-device) e agendamento automático de mensagens com proteção anti-spam. O projeto conta com um painel administrativo completo e uma API protegida por chaves de acesso dinâmicas.

Desenvolvido originalmente por **Marlon Souza**. Este projeto pode ser livremente copiado, modificado e distribuído, contanto que os créditos e as assinaturas do autor sejam estritamente mantidos tanto no código quanto na interface visual (conforme detalhado no arquivo `LICENSE`).

---

## 🚀 Funcionalidades Principais

*   **Multiusuário & Múltiplas Instâncias**: Crie e gerencie várias contas de WhatsApp conectadas simultaneamente.
*   **Banco de Dados PostgreSQL (Supabase)**: Migrado do SQLite local para o Supabase, ideal para deploys em nuvem (como Railway) sem perda de sessões ou configurações.
*   **Deploy Fácil via Docker**: Container completo pré-configurado com Chromium e as dependências necessárias para inicialização sem quebras de layout ou erros de biblioteca no Puppeteer.
*   **Mensagens Automáticas (Campanhas)**: Crie campanhas em massa para seus contatos salvos no banco.
*   **Recorrência Inteligente**: Programe repetição por dias da semana e horários múltiplos.
*   **Sistema de Fila & Proteção Anti-Spam**: Intervalo automático de segurança de **37 segundos** entre cada mensagem enviada, prevenindo banimentos no WhatsApp.
*   **Painel Administrativo Premium**: Interface dark premium com gestão de chaves de API, visualização de QR Code, envio de mensagens manuais e logs de tráfego (mensagens enviadas/recebidas).
*   **Chaves de API Seguras**: Chaves de API vinculadas a instâncias específicas com verificação de segurança no backend (um projeto não pode disparar em instâncias de terceiros).

---

## 🛠️ Tecnologias Utilizadas

*   **Backend**: Node.js, Express, PostgreSQL (`pg`).
*   **WhatsApp Library**: `whatsapp-web.js` (Multi-Device).
*   **Frontend**: Vanilla HTML5, CSS3 (variáveis, flexbox, custom scrolls) e JavaScript puro.
*   **Hospedagem & Nuvem**: Supabase (Postgres) e Railway (App Containerizer via Dockerfile).

---

## 📦 Como Instalar Localmente

### 1. Clonar o Repositório e Instalar Dependências
```bash
git clone https://github.com/marlico77/w-api.git
cd w-api
npm install
```

### 2. Configurar Variáveis de Ambiente
Crie um arquivo `.env` na raiz do projeto e adicione:
```env
PORT=3000
DATABASE_URL=postgresql://seu_usuario:sua_senha@seu_host:seu_porto/seu_banco
PUPPETEER_EXECUTABLE_PATH=/caminho/para/seu/chrome (opcional localmente)
```
*(Substitua a `DATABASE_URL` pela string de conexão do Supabase ou de outro Postgres ativo).*

### 3. Rodar a Aplicação
```bash
npm start
```
O sistema estará disponível em `http://localhost:3000`.

---

## 🌍 Como Hospedar no Railway + Supabase

1.  Crie uma conta no **Supabase** e copie a sua **Connection String (URI)** na seção *Database settings*.
2.  Crie um novo projeto no **Railway** a partir deste repositório GitHub.
3.  Adicione as seguintes **variáveis de ambiente (Variables)** no seu serviço no Railway:
    *   `DATABASE_URL`: *(Sua URL de Conexão do Supabase com a senha do banco)*
    *   `PUPPETEER_EXECUTABLE_PATH`: `/usr/bin/chromium`
4.  O Railway lerá automaticamente o arquivo `Dockerfile` e configurará o Chromium + as dependências nativas para o Puppeteer.
5.  **Persistência da Sessão (WhatsApp)**: Crie um **Volume** no painel principal do Railway e monte-o em `/app/.wwebjs_auth` vinculado ao serviço da aplicação para evitar que o WhatsApp desconecte após novos deploys.

---

## 🌐 Consumo da API Externa (Endpoints)

### Enviar Mensagem de Texto (POST)
Envia uma mensagem de texto simples através de uma instância configurada e conectada.

*   **URL:** `https://seu-sistema.up.railway.app/api/v1/instances/[NOME_DA_INSTANCIA]/send-text`
*   **Headers:**
    *   `Content-Type: application/json`
    *   `x-api-key: [SUA_CHAVE_API_VINCULADA]` *(Ou via Authorization: Bearer)*
*   **Body (JSON):**
    ```json
    {
      "number": "5511999999999",
      "message": "Olá! Esta é uma mensagem de teste enviada pela API externa."
    }
    ```
*   **Resposta (200 OK):**
    ```json
    {
      "success": true,
      "messageId": "ID_MENSAGEM_WHATSAPP",
      "timestamp": "2026-05-26T17:00:00.000Z"
    }
    ```

---

## ⚖️ Licença

Este software é licenciado nos termos da **Licença de Atribuição Obrigatória**. Você é livre para copiar, modificar e utilizar comercialmente, desde que os créditos e a assinatura visual a **Marlon Souza** sejam estritamente conservados na barra lateral do painel e no topo dos códigos-fonte.
