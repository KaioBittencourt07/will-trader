# WILL TRADER — Checklist de aceitação de release

Este checklist é o critério mínimo para chamar uma build de funcional. Abrir o dashboard ou receber HTTP 200 isoladamente não é prova suficiente.

## 1. Integridade do código

- [ ] Confirmar que o build é baseado na linha de desenvolvimento mais recente e que nenhum experimento congelado foi alterado.
- [ ] Revisar o diff inteiro antes de merge.
- [ ] Confirmar que `.env`, `localSecrets.js`, históricos, estados de monitor e diretórios de evidência não entram no commit nem na imagem.
- [ ] Confirmar que as chaves fictícias de `.env.example` são tratadas como ausentes.
- [ ] Em produção, configurar `WILL_API_ACCESS_TOKEN` como segredo do host com pelo menos 32 bytes aleatórios; o backend deve falhar ao iniciar se estiver ausente ou for um placeholder.

## 2. Validação automatizada

- [ ] `npm ci` no diretório `backend`.
- [ ] `npm test` no diretório `backend`.
- [ ] `node --test tests/*.test.js` na raiz.
- [ ] Construção bem-sucedida da imagem Docker de produção.
- [ ] Smoke test da imagem: `/health` retorna JSON válido com `ok: true` e o dashboard é servido em `/dashboard/`.
- [ ] A CI mostra conclusão `success`; jobs pendentes, cancelados ou sem evidência não contam como aprovados.

## 3. Configuração local / PAPER

- [ ] Definir `TWELVEDATA_API_KEY` real se for necessário consultar o provedor; nunca copiar o valor de exemplo como se fosse credencial.
- [ ] Validar `/api/market/status` e `/api/market/diagnostic`; erro, rate limit, dado stale ou candle inconsistente devem resultar em bloqueio/WAIT, não em sinal executável.
- [ ] Confirmar que `/health` informa `paperMonitorConfig.automatedBrokerExecution: false`.
- [ ] Confirmar que os feeds e o monitor estão desabilitados por padrão e só são habilitados após configuração consciente.
- [ ] Confirmar persistência, deduplicação e reabertura do histórico em reinício usando um arquivo de teste temporário.
- [ ] Validar os fluxos de entrada manual confirmada e resultado apenas após expiração; dados sem confirmação ou sem referência válida não devem ser marcados como WIN/LOSS.

## 4. Segurança de implantação — bloqueadores

- [ ] Confirmar que `/api/*` retorna `401` sem `Authorization: Bearer <token>` e aceita o token correto.
- [ ] Definir o mesmo token no cartão **Conexão segura com a API** do dashboard; o token fica no armazenamento local daquele navegador, não no HTML nem no repositório.
- [ ] Configurar `DASHBOARD_ORIGIN` para a origem real do dashboard no host de produção. CORS não é autenticação.
- [ ] Verificar limites de requisição, timeout, tamanho de payload e rate limit para evitar consumo acidental do orçamento do provedor.
- [ ] Verificar logs para garantir que não revelem chaves, cabeçalhos de autorização, URLs com credenciais ou payloads privados.
- [ ] Manter Avalon manual/read-only; nenhum auto-click, ordem real ou integração de corretora é aceito nesta etapa.

## 5. Critério de conclusão

A build só pode ser considerada **validada para PAPER/MANUAL** quando todos os itens automatizáveis acima passarem, a revisão do diff estiver concluída e os bloqueadores de segurança para o ambiente-alvo estiverem resolvidos. Isso não é declaração de rentabilidade nem aprovação para LIVE.
