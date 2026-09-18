// Buffer JSON until the writer has durably ended. No query parameter grants membership.
export function withCycleEvidenceRequest(handler) {
  return async (req,res) => {
    const controller=req.app.locals.cycleEvidenceRuntime;
    const cycleId=req.query.monitorCycleId ? String(req.query.monitorCycleId).slice(0,180) : null;
    if (!controller) return handler(req,res);
    // Reserve monitor IDs for internal one-time grants, including unknown/inactive IDs.
    if (!cycleId?.startsWith('autonomous-paper-monitor-v1:')) return handler(req,res);
    const header='x-will-cycle-evidence-capability';
    const capability=req.get?.(header) ?? req.headers?.[header];
    // Do not let downstream handlers echo or log the supplied credential.
    if (req.headers) delete req.headers[header];
    if (Array.isArray(req.rawHeaders)) req.rawHeaders=req.rawHeaders.flatMap((value,index,array)=>
      index%2===0 && String(value).toLowerCase()!==header ? [value,array[index+1]] : []);
    let authorized=false;
    try { authorized=controller.consumeRequestCapability(cycleId,capability); } catch {}
    if (!authorized) return res.status(controller.health().paused ? 503 : 403).json({ok:false,status:'EVIDENCE_AUTHORIZATION_REQUIRED'});
    let token, body, code=200;
    try {
      token=controller.beginCycleWriter(cycleId);
      req.cycleEvidenceRecord = input => controller.commitRecord(token,input);
      const buffered={status(value){code=value;return this;},json(value){body=value;return this;}};
      try { await handler(req,buffered); }
      finally { delete req.cycleEvidenceRecord; controller.endCycleWriter(token); token=null; }
      if (controller.health().paused) throw new Error('EVIDENCE_PAUSED');
      return res.status(code).json(body);
    } catch {
      controller?.pause();
      return res.status(503).json({ok:false,status:'EVIDENCE_PAUSED'});
    }
  };
}
