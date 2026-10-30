export function createManualExecutionGateway({ brokerName = 'Avalon', brokerUrl = process.env.AVALON_TRADER_URL || null } = {}) {
  return {
    status() {
      return {
        broker: brokerName,
        mode: 'MANUAL_ONLY',
        automated: false,
        brokerUrl,
        reason: 'Nenhuma ordem é enviada sem API oficial, ambiente de teste e autorização explícita.'
      };
    },
    createHandoff(signal = {}) {
      if (!['BUY', 'SELL'].includes(signal.direction) || signal.blocked) {
        throw new Error('Somente sinais executáveis podem gerar instrução manual.');
      }
      return {
        mode: 'MANUAL_ONLY', broker: brokerName, brokerUrl,
        instruction: { asset: signal.asset ?? null, direction: signal.direction, clickTime: signal.clickTime ?? null, expirySeconds: signal.timing?.expirySeconds ?? null }
      };
    }
  };
}
