"""The northern A3 import must be reproducible and entirely OSM-derived."""
import copy
import importlib.util
import json
from pathlib import Path
import re
import unittest

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('north',ROOT/'scripts/extend_a3_north.py')
north=importlib.util.module_from_spec(spec)
spec.loader.exec_module(north)
current=json.loads(re.search(r'networkData:\s*MapData\s*=\s*(\{.*\});?\s*$',
    north.DATA_PATH.read_text(),re.S)[1])
source=json.loads(north.SOURCE_PATH.read_text())
imported=set(current['audit']['northExtension']['wayIds'])
baseline=copy.deepcopy(current)
baseline['roads']=[w for w in baseline['roads'] if w['wayId'] not in imported]
baseline['exits']=[e for e in baseline['exits'] if e['road']!='A3' or e['ref'] not in ['32','33']]
del baseline['audit']['northExtension']


class NorthExtensionTest(unittest.TestCase):
    def test_reproduces_retained_geometry_and_directional_junctions_exactly(self):
        before=copy.deepcopy(baseline)
        result,added,junctions=north.compile_extension(baseline,source)
        self.assertEqual(result,current)
        self.assertEqual(baseline,before)
        self.assertEqual(len(added),82)
        self.assertEqual(len(junctions),4)
        by_id={w['id']:w for w in source['elements'] if w['type']=='way'}
        for way in added:
            raw=by_id[way['wayId']]
            self.assertEqual(int(raw['tags']['lanes']),way['lanes'])
            pts=[list(north.point(p)) for p in raw['geometry']]
            start=pts.index(way['points'][0])
            self.assertEqual(way['points'],pts[start:start+len(way['points'])])
    def test_missing_osm_geometry_cannot_be_replaced_with_a_connector(self):
        empty={**source,'elements':[e for e in source['elements'] if e['type']!='way']}
        with self.assertRaisesRegex(ValueError,'No exact OSM continuation'):
            north.compile_extension(baseline,empty)
    def test_missing_lane_tags_cannot_be_guessed(self):
        incomplete=copy.deepcopy(source)
        for e in incomplete['elements']:
            if e['type']=='way':
                e.get('tags',{}).pop('lanes',None)
        with self.assertRaisesRegex(ValueError,'Unverified OSM lane count'):
            north.compile_extension(baseline,incomplete)
    def test_running_import_twice_cannot_duplicate_roads(self):
        with self.assertRaisesRegex(ValueError,'already present'):
            north.compile_extension(current,source)


if __name__=='__main__':
    unittest.main()
