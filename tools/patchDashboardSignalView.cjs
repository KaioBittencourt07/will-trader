const fs = require('fs');

const file = 'dashboard/index.html';
if (!fs.existsSync(file)) {
  throw new Error(`Arquivo nao encontrado: ${file}. Rode este script na raiz do repositorio.`);
}

let source = fs.readFileSync(file, 'utf8');
const start = source.indexOf('function stageRecommendation');
const end = source.indexOf('function localInput');

if (start < 0 || end < 0 || end <= start) {
  throw new Error('Bloco de funcoes do dashboard nao encontrado. Nenhuma alteracao foi gravada.');
}

const replacement = `function stageRecommendation(r={}){
  lastRecommendation=r.recommendation||null;

  if(!lastRecommendation){
    $('asset').textContent='Nenhum candidato nesta rodada válida';
    $('direction').textContent='EM ESTUDO';
    $('direction').className='direction wait';
    $('detail').textContent='Nenhuma direção válida liberada nesta rodada. O scanner continua.';
    $('review').disabled=true;
    return;
  }

  const d=lastRecommendation.decision||{};
  const dir=d.direction||'WAIT';
  const label=dir==='BUY'?'COMPRA':dir==='SELL'?'VENDA':'WAIT';
  const timingObject=d.timing&&typeof d.timing==='object'?d.timing:{};
  const timingStatus=d.timingStatus||timingObject.status||lastRecommendation.readiness?.classification||lastRecommendation.readiness?.status||'AGUARDANDO';
  const clickTime=d.clickTime||timingObject.clickTime||null;
  const validFrom=d.validFrom||timingObject.validFrom||null;
  const validUntil=d.validUntil||timingObject.validUntil||null;
  const ready=d.canClickNow===true||d.executable===true;

  $('asset').textContent=d.asset||lastRecommendation.snapshot?.asset||'—';
  $('direction').textContent=label;
  $('direction').className=\`direction \${dir==='BUY'?'buy':dir==='SELL'?'sell':'wait'}\`;

  if(dir==='WAIT'){
    $('detail').textContent='O WILL analisou o mercado e decidiu aguardar.';
  }else{
    const clickLabel=clickTime?fmt(clickTime):'—';
    const windowLabel=validFrom&&validUntil?\` · janela \${fmt(validFrom)}–\${fmt(validUntil)}\`:'';
    const stateLabel=ready?'TIMING LIBERADO':\`TIMING \${timingStatus}\`;
    $('detail').textContent=\`\${label} definida pelo WILL · horário do clique \${clickLabel}\${windowLabel} · \${stateLabel} · execução manual.\`;
  }

  $('review').disabled=false;
}

function review(){
  if(!lastRecommendation)return;

  const d=lastRecommendation.decision||{};
  const dir=d.direction||'WAIT';
  const label=dir==='BUY'?'COMPRA':dir==='SELL'?'VENDA':'WAIT';
  const timingObject=d.timing&&typeof d.timing==='object'?d.timing:{};
  const clickTime=d.clickTime||timingObject.clickTime||null;
  const validFrom=d.validFrom||timingObject.validFrom||null;
  const validUntil=d.validUntil||timingObject.validUntil||null;

  $('direction').textContent=label;
  $('direction').className=\`direction \${dir==='BUY'?'buy':dir==='SELL'?'sell':'wait'}\`;
  $('asset').textContent=d.asset||lastRecommendation.snapshot?.asset||'—';

  if(dir==='WAIT'){
    $('detail').textContent='O WILL decidiu aguardar.';
  }else{
    const clickLabel=clickTime?fmt(clickTime):'—';
    const windowLabel=validFrom&&validUntil?\` · janela \${fmt(validFrom)}–\${fmt(validUntil)}\`:'';
    $('detail').textContent=\`\${label} · horário do clique \${clickLabel}\${windowLabel} · nenhuma ordem é enviada automaticamente.\`;
  }

  activeHistoryId=lastRecommendation.historyId||null;
  refreshLearning();
}

`;

source = source.slice(0, start) + replacement + source.slice(end);
fs.writeFileSync(file, source, 'utf8');

console.log('DASHBOARD_SIGNAL_VIEW_PATCH_OK');
console.log('COMPRA:', source.includes('COMPRA'));
console.log('VENDA:', source.includes('VENDA'));
console.log('CLICK_TIME:', source.includes('horário do clique'));
console.log('MOJIBAKE:', source.includes('CÃ') || source.includes('â€”'));
