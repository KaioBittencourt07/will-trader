import { evaluateClickWindow } from '../../../engine/src/executionTiming.js';

const ASSET_PATTERN = /^[A-Z0-9][A-Z0-9._-]{0,15}(?:\/[A-Z0-9][A-Z0-9._-]{0,15})?$/;

function unavailable(message) {
  throw new Error(message);
}

export function createManualExecutionGateway({
  brokerName = 'Avalon',
  brokerUrl = process.env.AVALON_TRADER_URL || null,
  now = () => Date.now()
} = {}) {
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
      if (!signal || typeof signal !== 'object' || Array.isArray(signal)) {
        unavailable('Sinal inválido para instrução manual.');
      }
      if (!['BUY', 'SELL'].includes(signal.direction) || signal.blocked === true || signal.executable !== true) {
        unavailable('Somente sinais executáveis podem gerar instrução manual.');
      }

      const asset = typeof signal.asset === 'string' ? signal.asset.trim().toUpperCase() : '';
      if (!ASSET_PATTERN.test(asset)) {
        unavailable('Ativo ausente ou inválido para instrução manual.');
      }

      const clickTimeMs = Date.parse(signal.clickTime ?? '');
      const timingClickMs = Date.parse(signal.timing?.clickTime ?? '');
      if (!Number.isFinite(clickTimeMs) || clickTimeMs !== timingClickMs) {
        unavailable('Horário da instrução ausente ou inconsistente.');
      }

      const window = evaluateClickWindow(signal.timing, now());
      if (!window.canClick) {
        unavailable(window.status === 'TOO_EARLY'
          ? 'Janela de entrada ainda não começou.'
          : window.status === 'EXPIRED'
            ? 'Janela de entrada expirada; gere uma nova análise.'
            : 'Janela de entrada inválida.');
      }

      const expiryTimeMs = Date.parse(signal.timing?.expiryTime ?? '');
      if (!Number.isFinite(expiryTimeMs) || expiryTimeMs <= clickTimeMs) {
        unavailable('Expiração ausente ou inválida.');
      }

      return {
        mode: 'MANUAL_ONLY',
        broker: brokerName,
        brokerUrl,
        instruction: {
          asset,
          direction: signal.direction,
          clickTime: new Date(clickTimeMs).toISOString(),
          expiryTime: new Date(expiryTimeMs).toISOString(),
          expirySeconds: Math.round((expiryTimeMs - clickTimeMs) / 1_000)
        }
      };
    }
  };
}
