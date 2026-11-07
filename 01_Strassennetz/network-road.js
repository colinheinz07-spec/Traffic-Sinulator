/** 01_Strassennetz: Zugeordnetes Fachmodul network-road. */
import { routeDescriptor } from '../network-catalog.js?build=3b44a696873cb354';
/** All motorway numbers come from network metadata; adding an A61, A7 or
 * A100 corridor needs no additional conditional here. Ramps are not roads. */
export function networkRoad(key) {
    return routeDescriptor(key)?.motorway ?? null;
}
