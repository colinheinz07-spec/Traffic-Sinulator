import { diversionJunctions } from './diversions.js?build=9b83d91f0feef117';
export function normalJunctionTraffic(route, exits, demandVph) {
    if (route.key.startsWith('ramp-'))
        return [];
    return diversionJunctions(route.key, exits, route).filter(j => !j.isInterchange).map(j => {
        // 4–8% local turnover per AS. Balanced ordinary entry/exit at the
        // reference free flow avoids artificially growing demand at every node.
        const share = 4 + Number(j.ref) % 5;
        return { id: route.key + ':local:' + j.ref, ref: j.ref, metre: j.metre,
            entryVph: Math.min(700, demandVph * share / 100), exitPercent: share,
            entryCapacityVph: 900, exitCapacityVph: 1200 };
    });
}
