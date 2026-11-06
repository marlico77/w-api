# SAPI API - Sistema de Automação de Mensagens do WhatsApp

O **SAPI API** é um sistema completo e de alto desempenho para gestão de múltiplas conexões de WhatsApp (Multi-device) e agendamento automático de mensagens com proteção anti-spam. O projeto conta com um painel administrativo completo e uma API protegida por chaves de acesso dinâmicas.

Desenvolvido originalmente por **Marlon Souza**. Este projeto pode ser livremente copiado, modificado e distribuído, contanto que os créditos e as assinaturas do autor sejam estritamente mantidos tanto no código quanto na interface visual (conforme detalhado no arquivo `LICENSE`).

---

## 🚀 Funcionalidades Principais

*   **Multiusuário & Múltiplas Instâncias**: Crie e gerencie várias contas de WhatsApp conectadas simultaneamente.
*   **Banco de Dados PostgreSQL (Supabase)**: Migrado do SQLite local para o Supabase, ideal para deploys em nuvem (como Railway) sem perda de sessões ou configurações.
*   **Deploy Fácil via Docker**: Container completo pré-configurado com Chromium e as dependências necessárias para inicialização sem quebras de layout ou erros de biblioteca no Puppeteer.
*   **Mensagens Automáticas (Campanhas)**: Crie campanhas em massa para seus contatos salvos no banco.
*   **Recorrência Inteligente**: Programe repetição por dias da semana e horários múltiplos.
*   **Controles de envio**: consentimento explícito registrado por contato, no máximo 20 envios por instância, 5 destinatários distintos e 3 envios por contato em 24 horas, com intervalo mínimo de 120 segundos. Esses limites são escolhas conservadoras do projeto, não limites oficiais nem garantia contra banimento.
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
INITIAL_ADMIN_PASSWORD=uma_senha_unica_com_pelo_menos_16_caracteres
JWT_SECRET=um_segredo_aleatorio_longo_e_persistente
GOOGLE_CLIENT_ID=seu_client_id_google_se_usar_login_google
ENABLE_CAMPAIGNS=false
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
    *   `INITIAL_ADMIN_PASSWORD`: senha inicial forte; obrigatória em banco novo e para substituir a senha padrão antiga
    *   `JWT_SECRET`: segredo persistente para os tokens do painel
4.  O Railway lerá automaticamente o arquivo `Dockerfile` e configurará o Chromium + as dependências nativas para o Puppeteer.
5.  **Persistência da Sessão (WhatsApp)**: Crie um **Volume** no painel principal do Railway e monte-o em `/app/.wwebjs_auth` vinculado ao serviço da aplicação para evitar que o WhatsApp desconecte após novos deploys.

---

## 🌐 Consumo da API Externa (Endpoints)

### Antes de enviar

Os contatos importados começam sem autorização de envio. Depois de obter consentimento explícito fora do sistema, salve o contato e registre sua origem com `POST /api/instances/[NOME]/contacts/[NUMERO]/consent`, autenticado pelo token do painel, com corpo `{"source":"Formulário de cadastro de 2026-11-06"}`. O registro é uma declaração do operador; guarde a prova original do consentimento. Pedidos de saída recebidos pelo WhatsApp revogam a autorização.

Campanhas ficam desativadas por padrão. Só defina `ENABLE_CAMPAIGNS=true` após revisar a lista de contatos e as políticas aplicáveis. Envios diretos e campanhas passam pelos mesmos limites. Falhas de envio com resultado incerto ficam em `needs_review` e exigem revisão manual antes de qualquer nova tentativa.

Se o WhatsApp retornar sinais de restrição `463` ou `475`, os envios da instância são pausados no banco. Consulte `GET /api/instances/[NOME]/outbound-pause`. Depois de investigar a causa e confirmar que a conta pode voltar a operar, um usuário com acesso à instância pode remover a pausa com `DELETE` no mesmo caminho. Não reinicie nem reconecte repetidamente a sessão para tentar contornar uma restrição.

Esta integração usa `whatsapp-web.js`, que não é oficial. Pausas, limites e consentimento reduzem riscos, mas não eliminam a possibilidade de restrição. O intervalo e os limites numéricos acima são escolhas internas: a Meta não os publica como patamares seguros. Não use as campanhas deste conector Web como substituto da Plataforma oficial para mensagens comerciais automatizadas em produção.

### Requisitos e melhorias segundo a Meta

A Política de Mensagens do WhatsApp Business exige que o destinatário tenha fornecido o número e aceitado receber mensagens da empresa, com o nome da empresa claro no fluxo de aceitação. Pedidos de interrupção feitos dentro **ou fora** do WhatsApp precisam ser respeitados. A Meta recomenda consentimentos separados por categoria, especialmente para promoções, e acompanhar qualidade, leitura e motivos de bloqueio. O campo `source` atual registra apenas uma declaração do operador; ainda é necessário guardar a prova original, a empresa identificada, a categoria autorizada e a versão do texto aceito no sistema que coletou o consentimento.

Na **Plataforma oficial**, iniciar uma conversa exige um modelo de mensagem aprovado. Mensagens livres respondendo ao usuário são permitidas dentro de 24 horas da última mensagem recebida; fora desse período, usa-se um modelo aprovado. Essas regras técnicas não são implementadas pelo conector `whatsapp-web.js`. Para operar campanhas, o próximo passo arquitetural é adicionar um provedor Cloud API, webhooks de status, modelos aprovados e monitoramento da qualidade do número no WhatsApp Manager. Migração e testes com um número real são necessários antes de habilitar campanhas em produção.

Fontes oficiais: [Política de Mensagens](https://business.whatsapp.com/policy/preview?lang=pt_BR), [boas práticas de marketing](https://whatsappbusiness.com/wp-content/uploads/2026/04/Best-Practices-for-Marketing-Messages-on-WhatsApp-.pdf) e [coleção Cloud API da Meta](https://www.postman.com/meta/whatsapp-business-platform/overview).

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
*   **Resposta (200 OK), após consentimento registrado:**
    ```json
    {
      "success": true,
      "messageId": "ID_MENSAGEM_WHATSAPP",
      "timestamp": "2026-05-26T17:00:00.000Z"
    }
    ```

---

## 💬 Integração de Chat e Eventos em Tempo Real (SSE)

Para construir seu próprio painel de chat externo ou integrar as conversas em tempo real no seu CRM/ERP, a API V1 fornece endpoints dedicados autenticados pela chave de API (`x-api-key` ou parâmetro `api_key` na query):

*   **Listar Conversas (GET):** `/api/v1/instances/[NOME]/chats`
*   **Histórico de Mensagens (GET):** `/api/v1/instances/[NOME]/chats/[CHAT_ID]/messages?limit=50`
*   **Proxy de Avatar (GET):** `/api/v1/instances/[NOME]/chats/[CHAT_ID]/avatar`
*   **Download de Mídias (GET):** `/api/v1/instances/[NOME]/messages/[MESSAGE_ID]/media?chatId=[CHAT_ID]`
*   **Marcar como Lido (POST):** `/api/v1/instances/[NOME]/chats/[CHAT_ID]/seen`
*   **Enviar Mídia (POST):** `/api/v1/instances/[NOME]/send-media`
*   **Apagar/Revogar Mensagem (DELETE):** `/api/v1/instances/[NOME]/chats/[CHAT_ID]/messages/[MESSAGE_ID]`
*   **Stream SSE Real-Time (GET):** `/api/v1/instances/[NOME]/chat-sse?api_key=[CHAVE]`

### 💻 Cliente de Chat Demonstrativo Standalone

Incluímos no projeto um exemplo prático completo e autossuficiente de um cliente de chat externo no arquivo [public/chat-demo.html](public/chat-demo.html).

Para utilizá-lo:
1. Acesse `http://localhost:3000/chat-demo.html` em seu navegador.
2. Insira a URL da sua API, o ID da Instância e a sua Chave de API de Projeto.
3. Clique em **Conectar** para abrir o chat externo integrado com atualizações em tempo real via SSE.
4. Use este arquivo como modelo de referência (boilerplate) para construir a sua própria interface de chat externa.

---

## ⚖️ Licença

Este software é licenciado nos termos da **Licença de Atribuição Obrigatória**. Você é livre para copiar, modificar e utilizar comercialmente, desde que os créditos e a assinatura visual a **Marlon Souza** sejam estritamente conservados na barra lateral do painel e no topo dos códigos-fonte.

