const REQUIRED = Object.freeze({
  OANDA: ['OANDA_ACCESS_TOKEN', 'OANDA_ACCOUNT_ID'],
  ALPACA: ['ALPACA_API_KEY', 'ALPACA_API_SECRET']
});

export function brokerReadiness(env = process.env) {
  const candidates = [
    { broker: 'Avalon', markets: ['manual'], officialTradingApiConfigured: false, mode: 'MANUAL_ONLY', reason: 'Nenhuma API oficial de execução foi verificada para esta integração.' },
    ...Object.entries(REQUIRED).map(([broker, keys]) => {
      const missing = keys.filter((key) => !env[key]);
      return {
        broker,
        markets: broker === 'OANDA' ? ['FOREX'] : ['STOCKS', 'CRYPTO'],
        officialTradingApiConfigured: missing.length === 0,
        mode: missing.length ? 'NOT_CONFIGURED' : 'PAPER_READY',
        missing,
        reason: missing.length ? 'Credenciais de ambiente ausentes.' : 'Credenciais detectadas; validar em ambiente PAPER antes de qualquer operação ao vivo.'
      };
    })
  ];
  return { candidates, liveExecutionEnabled: false, reason: 'Execução ao vivo permanece bloqueada até validação explícita de PAPER, risco e corretora.' };
}
