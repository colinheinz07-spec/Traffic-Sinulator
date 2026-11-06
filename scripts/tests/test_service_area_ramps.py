import unittest

from scripts.service_area_ramps import service_access_index,rest_area_only_ramp


def way(i,highway,points,**tags):
    return {'id':i,'tags':{'highway':highway,**tags},
            'geometry':[{'lat':p[0],'lon':p[1]} for p in points]}


class ServiceAreaAccessTests(unittest.TestCase):
    def test_service_only_rest_area_ramp_is_excluded(self):
        motorway=(50.0,7.0);parking=(50.005,7.005)
        ways=[way(1,'motorway_link',[motorway,parking]),
              way(2,'service',[parking,(50.006,7.006)])]
        by_id,service,public=service_access_index(ways)
        feature={'kind':'ramp','wayIds':[1],'points':[motorway,parking]}
        self.assertTrue(rest_area_only_ramp(feature,by_id,{motorway},service,public))

    def test_regular_exit_with_public_access_and_nearby_service_is_kept(self):
        motorway=(50,7);public_road=(50.005,7.005)
        ways=[way(1,'motorway_link',[motorway,public_road]),
              way(2,'primary',[public_road,(50.006,7.006)]),
              way(3,'service',[public_road,(50.006,7.007)])]
        by_id,service,public=service_access_index(ways)
        feature={'kind':'ramp','wayIds':[1],'points':[motorway,public_road]}
        self.assertFalse(rest_area_only_ramp(feature,by_id,{motorway},service,public))

    def test_interchange_between_motorways_is_never_removed(self):
        points=[(50,7),(50.003,7.003)]
        ways=[way(1,'motorway_link',points,service='rest_area')]
        by_id,service,public=service_access_index(ways)
        feature={'kind':'ramp','wayIds':[1],'points':points}
        self.assertFalse(rest_area_only_ramp(feature,by_id,set(points),service,public))

    def test_explicit_rastplatz_destination_is_excluded(self):
        a=(50,7);b=(50.001,7.001)
        ways=[way(1,'motorway_link',[a,b],destination='PWC Rastplatz')]
        by_id,service,public=service_access_index(ways)
        feature={'kind':'ramp','wayIds':[1],'points':[a,b]}
        self.assertTrue(rest_area_only_ramp(feature,by_id,{a},service,public))


if __name__=='__main__':
    unittest.main()
