# WILL TRADER — Runbook local da branch de reconstrução

## 0. Não tocar no workspace antigo

O workspace antigo pode conter alterações não commitadas, JSON de histórico e canary de commissioning. Não executar reset, clean, checkout forçado ou apagar a pasta antiga.

Faça uma cópia de segurança do workspace antigo com o script desta branch:

    powershell -ExecutionPolicy Bypass -File ./scripts/backup-local-workspace.ps1 -SourcePath "C:/Users/skdri/will-trader-git" -DestinationRoot "C:/Users/skdri"

O script copia o workspace sem .git, node_modules e arquivos de segredo; registra status/diff/untracked e não modifica a origem. Os arquivos .env ficam no workspace original e não são copiados.

Para uma cópia adicional dos dados JSON com verificação SHA-256, execute a partir da raiz desta branch:

    npm.cmd run backup:runtime-data -- --source "C:/Users/skdri/will-trader-git/backend/data" --out "C:/Users/skdri"

Não apagar o workspace antigo até verificar os dois backups.

## 1. Clonar a branch isolada

Use uma pasta nova; não reaproveite a pasta antiga:

    git clone --branch rebuild/will-trader-foundation-2026-11-08 https://github.com/KaioBittencourt07/will-trader.git C:/Users/skdri/will-trader-rebuild
    Set-Location C:/Users/skdri/will-trader-rebuild

## 2. Configurar e verificar

    Copy-Item backend/.env.example backend/.env
    npm.cmd ci --prefix backend
    npm.cmd run verify

Edite backend/.env localmente e configure somente os providers para os quais você já tem credenciais. Não cole chaves no chat nem as versione no Git.

Para gerar um token local do bridge Avalon:

    node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

Coloque o resultado em WILL_AVALON_RELAY_TOKEN no backend/.env. Use o mesmo token quando o script do navegador solicitar. Não use senha da corretora como token.

## 3. Iniciar o backend e abrir o dashboard

    npm.cmd run start:backend

Abra http://127.0.0.1:3000/dashboard.

A execução atual é manual/PAPER. Não há auto-click nem envio de ordens reais.

## 4. Conectar Avalon em modo SHADOW

Siga docs/AVALON_BRIDGE_SETUP.md. O script tools/avalon-bridge.js precisa ser instalado na sessão autorizada da Traderoom antes de recarregar a página.

O dashboard mostra IDs e cotações recebidos. A ponte não participa do motor de decisão até que o operador confirme o mapeamento de cada active_id e a semântica dos timestamps com fonte independente.

## 5. IA sob demanda

A seção de auditoria de IA só fica disponível quando pelo menos um revisor estiver configurado. A consulta acontece apenas quando o usuário clica e pode consumir créditos da API. Ela não é executada em cada ciclo do scanner e não grava uma segunda entrada no histórico.

## 6. Bloqueios antes da operação

- Recuperar e validar os arquivos JSON do workspace antigo.
- Identificar o banco externo mencionado pelo operador, se existir. Nenhum banco SQL do WILL foi identificado nesta auditoria.
- Validar feeds e timestamps em runtime.
- Confirmar o mapeamento Avalon e sua frescura.
- Validar PAPER, gestão de risco, circuit breaker e recuperação após reinício.
- Só considerar operação real após aprovação explícita e evidência completa.
