"""OSM ramp coverage must follow exact physical junction nodes, not labels."""
import unittest
from scripts.repair_osm_ramp_gaps import within_ramp_audit_scope


class RampAuditScopeTests(unittest.TestCase):
    def test_verified_ramp_further_than_label_radius_is_imported(self):
        shared = (50.9111111, 7.0222222)
        geometry = [(50.9111111, 7.0222222), (50.9112222, 7.0223333)]
        self.assertTrue(within_ramp_audit_scope(geometry, {shared}, 3200))

    def test_unconnected_remote_way_is_not_falsely_added(self):
        geometry = [(50.9121111, 7.0232222), (50.9122222, 7.0233333)]
        self.assertFalse(within_ramp_audit_scope(geometry, {(50.9121110, 7.0232222)}, 3200),
                         "merely close points are not identical OSM nodes")

    def test_named_junction_audit_still_includes_detached_original_geometry(self):
        geometry = [(50.9111111, 7.0222222), (50.9112222, 7.0223333)]
        self.assertTrue(within_ramp_audit_scope(geometry, set(), 1400))


if __name__ == "__main__":
    unittest.main()
