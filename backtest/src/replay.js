export function replay(records = [], decideFn) {
  if (typeof decideFn !== 'function') throw new TypeError('decideFn deve ser uma função.');

  return records
    .slice()
    .sort((a, b) => Date.parse(a?.timestamp) - Date.parse(b?.timestamp))
    .map((market, index) => {
      const decision = decideFn(market, index);
      return {
        index,
        timestamp: market.timestamp,
        asset: market.asset,
        price: market.price,
        decision
      };
    });
}
