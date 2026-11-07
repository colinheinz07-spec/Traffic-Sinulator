"""Bei jeder Regeneration die extra importierten, OSM-verifizierten Rampen
wieder in den Katalog aufnehmen. Die Original-OSM-Geometrie kommt aus
src/01_Strassennetz/osm-zusatzrampen.ts.
"""
import re
from pathlib import Path

IMPORT="import {verifiedOsmAdditionalRoutes,verifiedOsmStreetBoundaries} from './01_Strassennetz/osm-zusatzrampen.js';"

def attach_verified_osm_links(content:str)->str:
    if IMPORT in content:
        return content
    head="import type {Point,Exit} from './core.js';"
    assert content.count(head)==1,"Extension TS header changed"
    content=content.replace(head,head+"\n"+IMPORT,1)
    ids=r"(export const EXTENSION_IDS=)(\[[^\n]+\])( as const;)"
    def add_ids(m):
        return m.group(1)+"[..."+m.group(2)+",...verifiedOsmAdditionalRoutes.map(r=>r.id)]"+m.group(3)
    content,count=re.subn(ids,add_ids,content,count=1)
    assert count==1,"Extension identifiers missing"
    routes=r"(export const extensionRoutes:ExtensionRoute\[\]=[^\n]+;)"
    content,count=re.subn(routes,r"\1\nextensionRoutes.push(...verifiedOsmAdditionalRoutes);",content,count=1)
    assert count==1,"Extension routes missing"
    bounds=r"(export const extensionRampBoundaryPoints:Point\[\]=[^\n]+;)"
    content,count=re.subn(bounds,r"\1\nextensionRampBoundaryPoints.push(...verifiedOsmStreetBoundaries);",content,count=1)
    assert count==1,"OSM local boundaries missing"
    return content

def patch_generated_extensions(root:Path):
    target=root/'src/network-extensions.ts'
    src=target.read_text()
    patched=attach_verified_osm_links(src)
    if patched!=src:target.write_text(patched)
