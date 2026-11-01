export function networkRoad(key) { return key.startsWith('A3-') ? 'A3' : key.startsWith('A48-') ? 'A48' : key.startsWith('extra-a59-') ? 'A59' : key.startsWith('extra-a560-') ? 'A560' : null; }
