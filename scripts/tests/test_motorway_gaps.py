"""Gap restoration must use OSM ways and never invent road vertices."""
import importlib.util
import json
from pathlib import Path
import re
import unittest

src=Path(__file__).resolve().parents[1]/'fill_motorway_gaps.py'
spec=importlib.util.spec_from_file_location('fill_motorway_gaps', src)
gap=importlib.util.module_from_spec(spec);spec.loader.exec_module(gap)
text=gap.DATA_PATH.read_text()
original=json.loads(re.search(r'networkData:\s*MapData\s*=\s*(\{.*\});?\s*$',text,re.S).group(1))

class GeometryRepairTest(unittest.TestCase):
    def test_short_verified_osm_segment_bridges_gap(self):
        # Use three genuine contiguous OSM ways from the existing map; remove
        # one and present precisely that removed real OSM way as Overpass data.
        rs=[x for x in original['roads'] if x['road']=='A3-frankfurt']
        ends={}
        for r in rs:
            for p in (r['points'][0],r['points'][-1]):ends.setdefault(gap.key(p),[]).append(r)
        chosen=None
        for r in rs:
            if r['km']>0.12 or r['km']<0.015:continue
            a,b=gap.key(r['points'][0]),gap.key(r['points'][-1])
            if len(ends.get(a,[]))==2 and len(ends.get(b,[]))==2:
                chosen=r;break
        self.assertIsNotNone(chosen)
        a,b=gap.key(chosen['points'][0]),gap.key(chosen['points'][-1])
        others=[x for x in rs if x['wayId']!=chosen['wayId']]
        before=gap.terminals(others)
        self.assertIn(a,before);self.assertIn(b,before)
        osmel={'type':'way','id':chosen['wayId'],'tags':{'highway':'motorway','ref':'A 3','lanes':str(chosen['lanes'])},
              'geometry':[{'lat':p[0],'lon':p[1]} for p in chosen['points']]}
        sample={'roads':[x for x in original['roads'] if x['wayId']!=chosen['wayId']]}
        repaired,audit=gap.collect_verified_bridges(sample,[osmel])
        self.assertEqual(len(repaired),1)
        self.assertEqual(repaired[0]['wayId'],chosen['wayId'])
        self.assertEqual(set(map(tuple,repaired[0]['points'])),set(map(tuple,chosen['points'])))
        self.assertLess(audit['A3-frankfurt']['danglingAfter'],audit['A3-frankfurt']['danglingBefore'])
    def test_no_fake_bridge_when_no_osm_way_exists(self):
        audit, stats=gap.collect_verified_bridges({'roads':original['roads']},[])
        self.assertEqual(audit,[])
        self.assertEqual(stats['A3-koeln']['danglingAfter'],stats['A3-koeln']['danglingBefore'])

if __name__=='__main__':unittest.main()
