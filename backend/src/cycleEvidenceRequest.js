// Buffer JSON until the writer has durably ended. No query parameter grants membership.
export function withCycleEvidenceRequest(handler) {
  return async (req,res) => {
    const controller=req.app.locals.cycleEvidenceRuntime;
    const cycleId=req.query.monitorCycleId ? String(req.query.monitorCycleId).slice(0,180) : null;
    if (!controller) return handler(req,res);
    let membership;
    try { membership=controller.membershipForCycle(cycleId); }
    catch { return res.status(503).json({ok:false,status:'EVIDENCE_PAUSED'}); }
    if (!membership) return handler(req,res);
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
