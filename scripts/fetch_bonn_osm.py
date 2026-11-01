"""Retain Bonn's A59/A562 and connected public roads from OpenStreetMap."""
import json
import concurrent.futures
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HIGHWAYS = 'motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|residential|unclassified'

def fetch():
    # Small overlapping map tiles avoid relying on a busy Overpass instance.
    centers = [(50.783, 7.151), (50.772, 7.145), (50.761, 7.141),
        (50.750, 7.148), (50.739, 7.154), (50.728, 7.160),
        (50.722, 7.150), (50.714, 7.141), (50.706, 7.131)]
    def tile(center):
        lat, lon = center
        bbox = f'{lon-.012},{lat-.009},{lon+.012},{lat+.009}'
        url = 'https://api.openstreetmap.org/api/0.6/map.json?' + urllib.parse.urlencode({'bbox': bbox})
        request = urllib.request.Request(url, headers={'User-Agent': 'Traffic-Simulator/1.19 OSM source import'})
        with urllib.request.urlopen(request, timeout=40) as response:
            data = json.load(response)
        print('Fetched Bonn tile', center, len(data['elements']), flush=True)
        return data
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        tiles = list(executor.map(tile, centers))
    items = {(e['type'], e['id']): e for data in tiles for e in data['elements']}
    nodes = {e['id']: e for e in items.values() if e['type'] == 'node'}
    ways = [e for e in items.values() if e['type'] == 'way' and e.get('tags', {}).get('highway') in HIGHWAYS.split('|')]
    for way in ways:
        way['geometry'] = [{'lat': nodes[n]['lat'], 'lon': nodes[n]['lon']} for n in way['nodes']]
    for road in ['A59', 'A562']:
        assert any(e.get('tags', {}).get('highway') == 'motorway'
            and road in e['tags'].get('ref', '').replace(' ', '').split(';') for e in ways), road
    junctions = [n for n in nodes.values() if n.get('tags', {}).get('highway') == 'motorway_junction']
    data = {'source': 'OpenStreetMap API 0.6 map; © OpenStreetMap contributors; ODbL',
        'osm3s': tiles[-1].get('osm3s', {}), 'tiles': centers, 'elements': ways + junctions}
    output = ROOT / 'data/bonn-a59-a562-osm.json'
    output.write_text(json.dumps(data, separators=(',', ':')))
    print('Saved', len(ways), 'ways and', len(junctions), 'junction nodes to', output.name, flush=True)

if __name__ == '__main__':
    fetch()
