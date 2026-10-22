# Backend WILL TRADER

O backend serve o dashboard em `/dashboard/`, a API de análise, telemetria de mercado e os fluxos de histórico/PAPER. O gateway de corretora continua `MANUAL_ONLY`.

## Desenvolvimento local

1. Use Node.js 22 LTS.
2. No diretório `backend`, instale as dependências com `npm ci`.
3. Copie `.env.example` para `.env` e troque todos os placeholders pelas configurações reais que você usa. Nunca committe `.env` nem `backend/src/localSecrets.js`.
4. Execute `npm start`; o padrão local é `http://127.0.0.1:3000/dashboard/`.
5. Para testar a conexão do dashboard: `npm run smoke:dashboard -- http://127.0.0.1:3000`.

Sem `TWELVEDATA_API_KEY` real, o backend pode iniciar, mas os dados de mercado externos não estarão disponíveis. Erro, atraso ou inconsistência do feed devem produzir bloqueio/WAIT, não cotações inventadas.

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


## Relay local de mercado

O relay local usa `WILL_API_ACCESS_TOKEN` apenas quando o destino é loopback (`localhost`, `127.0.0.1` ou `::1`). Se `WILL_LOCAL_MARKET_RELAY` apontar para outro host, configure `WILL_LOCAL_MARKET_RELAY_TOKEN` com um segredo exclusivo aceito por esse serviço; o token geral da API não é encaminhado para hosts remotos. O relay padrão segue a porta `PORT` do próprio backend.


## Revisão por IA e fallback determinístico

O modelo OpenAI padrão é `gpt-6-luna`; configure `OPENAI_MODEL` apenas para um modelo habilitado na sua conta. A API não é considerada operacional só porque a chave existe: uma chamada real depende de chave válida, modelo disponível e saldo/limites da conta. O fallback determinístico é mantido ligado por compatibilidade se nenhuma variável for definida; use `ALLOW_DETERMINISTIC_FALLBACK=false` para exigir a revisão por IA. `AI_FALLBACK_ENABLED`, se definida, tem precedência por compatibilidade com ambientes anteriores. Com fallback desativado, falha/ausência da IA não deve ser interpretada como consenso aprovado.
