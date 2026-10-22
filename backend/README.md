# Backend WILL TRADER

O backend serve o dashboard em `/dashboard/`, a API de análise, telemetria de mercado e os fluxos de histórico/PAPER. O gateway de corretora continua `MANUAL_ONLY`.

## Desenvolvimento local

1. Use Node.js 22 LTS.
2. No diretório `backend`, instale as dependências com `npm ci`.
3. Copie `.env.example` para `.env` e troque todos os placeholders pelas configurações reais que você usa. Nunca committe `.env` nem `backend/src/localSecrets.js`.
4. Execute `npm start`; o padrão local é `http://127.0.0.1:3000/dashboard/`.
5. Para testar a conexão do dashboard: `npm run smoke:dashboard -- http://127.0.0.1:3000`.

Sem `TWELVEDATA_API_KEY` real, o backend pode iniciar, mas os dados de mercado externos não estarão disponíveis. Erro, atraso ou inconsistência do feed devem produzir bloqueio/WAIT, não cotações inventadas.

O Market Data Engine aplica um limitador seriado, deduplicação/cache e orçamentos estimados de crédito por minuto e por janela móvel de 24 horas. O fallback para Twelve Data é **6 créditos/minuto e 720/24h**; o `.env.example` mostra 8/min e 720/24h como configuração de exemplo para um plano básico, usando `MARKET_MIN_REQUEST_INTERVAL_MS=60000`. Ajuste esses valores ao plano real e mantenha margem para outros usos da mesma chave. O custo é estimado a partir das chamadas quote + time_series por símbolo; cabeçalhos de uso retornados pelo provedor, quando presentes, são evidência melhor que a estimativa local. O orçamento diário não deixa a rota HTTP esperando até o reset: se os créditos não forem liberados em até `MARKET_MAX_DAILY_CREDIT_WAIT_MS` (padrão 10 segundos), retorna bloqueio explícito `PROVIDER_DAILY_CREDIT_BUDGET_EXHAUSTED`. Configure um valor menor se preferir respostas mais rápidas.

## Proteção da API

- Em `NODE_ENV=production`, `WILL_API_ACCESS_TOKEN` é obrigatório e deve ter no mínimo 32 bytes. O serviço se recusa a iniciar se o token estiver ausente, curto ou for o placeholder de exemplo.
- Todas as rotas sob `/api/*` exigem `Authorization: Bearer <WILL_API_ACCESS_TOKEN>`. `/health` permanece público para health checks do host.
- O cartão **Conexão segura com a API** no dashboard permite inserir/remover o mesmo token no navegador. Não coloque o token no HTML, Git, URL ou configuração pública.
- Em produção, configure `DASHBOARD_ORIGIN` para a origem verdadeira do dashboard. CORS não substitui autenticação.

## Testes

- `npm test -- --test-timeout=60000 --test-force-exit` executa os testes do backend com timeout por teste.
- Na raiz, `node --test --test-timeout=60000 --test-force-exit tests/*.test.js` executa a suíte de regressão completa.
- O CI constrói a imagem Docker e testa `/health`, o dashboard e os cenários com/sem token. Não considere validação concluída enquanto o job não terminar em sucesso.

Nenhuma dessas verificações demonstra rentabilidade. Não foi autorizada execução automática na Avalon ou em outra corretora.

## Coleta histórica para análise (sempre opt-in)

O coletor `market:history` faz **uma requisição histórica para um ativo** quando invocado, e nunca roda no startup ou na CI. Ele exige a confirmação `--confirm-provider-credits`, uma chave real e janela temporal em ISO-8601 com fuso explícito. A chamada é limitada a 5.000 barras e a intervalos intraday suportados; janelas futuras e nomes de arquivo já existentes são recusados antes de consultar a API.

No PowerShell:

```powershell
cd backend
$env:TWELVEDATA_API_KEY = "SUA_CHAVE_REAL"
npm run market:history -- --asset EUR/USD --interval 1min --start 2026-10-01T12:00:00Z --end 2026-10-01T13:00:00Z --confirm-provider-credits
```

A saída local fica em `../data/market-datasets/` e não é enviada ao Git nem empacotada no Docker. O coletor guarda os bytes brutos, observações derivadas somente de barras fechadas e manifestos SHA-256. Ele não sobrescreve arquivos existentes e não declara edge. Leia o [protocolo de validação](../docs/MARKET_VALIDATION_PROTOCOL.md) e confira as quotas do seu plano antes de executar; os cabeçalhos de créditos reportados pela API são mais autoritativos do que qualquer estimativa local.



## Replay histórico do WILL e verificação offline

Depois de coletar um dataset, copie o ID informado pela saída `market:history` e execute:

```powershell
cd backend
npm run market:replay -- --dataset-id <ID> --payout-ratio 0.8 --stake 1 --cost-per-trade 0.01 --minimum-binary-trades 100
npm run market:verify-replay -- --dataset-id <ID>
```

O replay reconstrói barras OHLC fechadas do JSON bruto verificado e reexecuta `deriveTechnical` + `runWillPipeline` sobre cada prefixo histórico. Ele não consulta rede nem aciona advisors externos, scanner, histórico live ou corretora. Os preços de entrada/expiração vêm de aberturas futuras de velas; gaps tardios são `UNRESOLVED`. Relatórios/datasets existentes nunca são substituídos.

Por padrão, sem uma timeline histórica de macro/notícias autenticada, o replay bloqueia sinais. Para diagnóstico *somente técnico*, adicione explicitamente `--technical-only-diagnostic`; esse modo ignora os filtros macro/notícias e não representa a estratégia completa. Sem `--payout-ratio`, as métricas financeiras permanecem indisponíveis. Com payout, o resultado continua hipotético e não prova edge.

## Relay local de mercado

O relay local reutiliza `WILL_API_ACCESS_TOKEN` somente para destinos loopback (`localhost`, `127.0.0.1` ou `::1`). Para `WILL_LOCAL_MARKET_RELAY` apontando a outro host, configure um `WILL_LOCAL_MARKET_RELAY_TOKEN` exclusivo aceito pelo serviço remoto; o token geral da API nunca é enviado a um host remoto. O relay padrão segue a porta `PORT` do backend.

## Revisão por IA e fallback determinístico

O modelo OpenAI padrão é `gpt-6-luna`; configure `OPENAI_MODEL` somente para um modelo habilitado na sua conta. Uma chave presente não prova que a chamada real funcionará: ela depende de chave válida, modelo disponível e limites da conta. O fallback determinístico permanece ligado por compatibilidade se nenhuma variável for definida; use `ALLOW_DETERMINISTIC_FALLBACK=false` para exigir revisão de IA. Se `AI_FALLBACK_ENABLED` estiver explicitamente definida, ela tem precedência por compatibilidade. Com fallback desativado, falha/ausência de IA não deve ser considerada consenso aprovado.
