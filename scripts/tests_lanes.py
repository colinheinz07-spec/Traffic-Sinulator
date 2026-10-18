import sys
from pathlib import Path
import unittest
sys.path.insert(0,str(Path(__file__).parent))
from audit_lanes import parse_tag_lanes,make_report
class LaneAuditTests(unittest.TestCase):
 def test_explicit(self):
  self.assertEqual(parse_tag_lanes({'lanes':'2','lanes:forward':'3'}),2)
 def test_no_fallback(self):
  self.assertIsNone(parse_tag_lanes({'lanes:backward':'2'}))
 def test_split(self):
  self.assertIsNone(parse_tag_lanes({'lanes':'1;2'}))
 def test_one_way_backward(self):
  self.assertIsNone(parse_tag_lanes({'oneway':'-1','lanes:forward':'2'}))
 def test_report(self):
  data={'roads':[{'wayId':1,'road':'A3-koeln','lanes':3,'km':.5,'points':[[50.46,7.76],[50.47,7.75]]}], 'ramps':[{'id':'r','name':'Ramp','lanes':1,'wayIds':[2]}]}
  a=make_report(data,{1:{'tags':{'lanes':'4'}},2:{'tags':{'lanes':'2'}}})
  self.assertEqual(a['roads'][0]['status'],'mismatch')
  self.assertEqual(a['ramps'][0]['explicitLanes'],[2])
if __name__=='__main__':unittest.main()
