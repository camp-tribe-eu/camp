"""Prompts for generated page photos. One record per image; prints a JSON list.

Rule: a recognisable landscape of THIS country / route / topic, never a
specific named campsite or business — campsite and provider pages get no
generated pictures of "their" place at all (it would show a real business
as something nobody photographed).
"""
import json

STYLE = ("Documentary travel photograph, natural light, shot on 35mm film, "
         "realistic colours and textures, every vehicle parked on solid ground, calm open sky in the upper third, "
         "people small and not facing the camera, no text, no logos, no signage, no watermark")

COUNTRY = {
 "at": ("Austria", "a turquoise alpine lake below limestone peaks in Tyrol, wooden farmhouses and meadows on the shore"),
 "be": ("Belgium", "the wooded Ardennes, a river looping through a green valley in morning mist, a slate-roofed village"),
 "bg": ("Bulgaria", "the Pirin mountains, a high meadow with granite peaks and pine forest, a clear stream"),
 "cz": ("Czechia", "the Vltava river bending below a Bohemian old town with red roofs and a castle tower, wooded hills"),
 "de": ("Germany", "the Moselle river loop with steep vineyards, a half-timbered village and a riverside meadow"),
 "dk": ("Denmark", "North Sea dunes with marram grass, a white lighthouse and a wide sandy beach"),
 "ee": ("Estonia", "a pine forest running down to a quiet Baltic shore with boulders and a wooden boardwalk"),
 "es": ("Spain", "a Costa Brava cove with umbrella pines, red rocks and turquoise Mediterranean water"),
 "fi": ("Finland", "a still Finnish lake in the long summer evening, granite shore, birch trees and a red wooden sauna cabin"),
 "fr": ("France", "the Dordogne valley, limestone cliffs, a stone village and a castle above a slow river lined with plane trees"),
 "gr": ("Greece", "an olive grove above the Ionian Sea, a small white chapel, a rocky headland and clear water"),
 "hr": ("Croatia", "the Istrian coast with pine trees on white rocks, clear Adriatic water and an island across the channel"),
 "hu": ("Hungary", "the reed-fringed shore of Lake Balaton, sailing boats and the volcanic hills of Badacsony behind"),
 "ie": ("Ireland", "Connemara, green hills, dry-stone walls, a lake and a single-track road under a changing sky"),
 "it": ("Italy", "Lake Garda with olive terraces, cypress trees and a lakeside village below steep mountains"),
 "lt": ("Lithuania", "the Curonian Spit, tall white dunes, pine forest and the Baltic lagoon"),
 "lu": ("Luxembourg", "the Sûre river valley with forested hills and a hilltop castle above a small town"),
 "lv": ("Latvia", "the Gauja valley, red sandstone cliffs above a slow river, pine and birch forest"),
 "mt": ("Malta", "the Gozo coastline, golden limestone cliffs, terraced fields and deep blue sea"),
 "nl": ("the Netherlands", "a Dutch polder with a row of windmills along a canal, cyclists on a dike path"),
 "pl": ("Poland", "the Masurian lakes, birch forest on the shore, small sailing boats on calm water"),
 "pt": ("Portugal", "the Douro valley, terraced vineyards falling to a wide river, a quinta on the slope"),
 "ro": ("Romania", "a Transylvanian Carpathian meadow with haystacks, wooden fences and a fortified church in the valley"),
 "se": ("Sweden", "the Swedish west coast archipelago, smooth pink granite rocks, red boathouses and a calm sea"),
 "si": ("Slovenia", "the emerald Soča river running through a gravel bed below the Julian Alps"),
 "sk": ("Slovakia", "the High Tatras, an alpine meadow below jagged peaks, a mountain stream and spruce forest"),
}

ROUTE = {
 "andalusia-in-winter": "Andalusia in winter: a motorhome on an empty road through the volcanic desert coast of Cabo de Gata, low winter sun, agave plants, the Mediterranean beyond",
 "baltic-coast-and-capitals": "the Baltic coast between Tallinn and Vilnius: a campervan parked by a pine-lined sandy beach, calm grey-blue sea, late summer evening",
 "dalmatian-coast-and-islands": "the Dalmatian coast between Zadar and Dubrovnik: a coastal road above turquoise Adriatic bays and islands, a campervan on the road",
 "danube-vienna-to-budapest": "the Danube between Vienna and Budapest: the river bend at Visegrád with wooded hills, a riverside meadow with a tent and bicycles",
 "dolomites-and-tyrol": "the Dolomites: pale jagged peaks above green alpine pastures and a winding mountain pass road with a campervan",
 "france-atlantic-coast": "the French Atlantic coast near the Dune du Pilat: a tall sand dune, pine forest, Atlantic surf, a campervan on a forest road",
 "peloponnese-loop": "the Peloponnese: a Venetian fortress above Nafplio harbour, olive hills and a coastal road with a campervan",
 "portuguese-atlantic": "the Portuguese Atlantic near Sagres: high ochre cliffs, a wild beach with surf, a campervan on a dirt track at the clifftop",
 "swedish-lakes-and-forests": "Dalarna in Sweden: a calm lake surrounded by spruce forest, a red wooden cottage, a canoe pulled up on the shore by a tent",
 "tuscany-hill-towns": "Tuscany: rolling hills with cypress-lined roads leading to a stone hill town with towers, golden evening light",
 "wadden-sea-and-dikes": "the Wadden Sea coast: a green dike with sheep, wide tidal mudflats at low tide, a lighthouse on the horizon",
 "wild-atlantic-way-cork-to-the-burren": "the Wild Atlantic Way: limestone pavement of the Burren meeting the Atlantic, a campervan on a narrow coastal road",
}

RENTAL = ["at", "de", "dk", "es", "fr", "hr", "ie", "it", "nl", "pt", "se", "si"]

TOPIC = {
 "water": ("Campsites by the water", "tents and a campervan pitched right at the water's edge, {land}"),
 "motorhome": ("Motorhome-friendly campsites", "a motorhome on a level gravel pitch with an electric hook-up post, {land}"),
 "dogs": ("Dog-friendly campsites", "a dog resting on the grass beside a tent and camping chairs, {land}"),
 "accessible": ("Accessible campsites", "a smooth paved path leading to a level pitch with a campervan, a person in a wheelchair seen from behind, {land}"),
 "classified": ("Officially classified campsites", "a well-kept campsite with neat hedged pitches, a campervan and tents, {land}"),
}
TOPIC_ONLY = {
 "water": "tents and a canoe at the edge of a clear European lake at dawn, mountains behind",
 "motorhome": "a motorhome on a level pitch with an electric hook-up post on a quiet European campsite, trees and hills",
 "dogs": "a happy dog lying on the grass beside a tent on a European campsite, evening light",
 "accessible": "a person in a wheelchair, seen from behind, on a smooth paved path between pitches of a green campsite",
 "classified": "a tidy European campsite with neat hedged pitches, campervans and tents, mature trees",
}


def rec(kind, slug, scene, alt):
    return {"kind": kind, "slug": slug,
            "prompt": f"{STYLE}. {scene[0].upper()}{scene[1:]}.", "alt": alt}


out = []
for c, (name, land) in COUNTRY.items():
    out.append(rec("country", c, f"camping in {land}, a few tents and a campervan parked on the grass, small in the landscape",
                   f"Camping landscape in {name} (AI illustration)"))
for s, scene in ROUTE.items():
    out.append(rec("route", s, scene, "Road-trip landscape on this route (AI illustration)"))
for c in RENTAL:
    name, land = COUNTRY[c]
    out.append(rec("rental", c, f"a rented white motorhome parked at a viewpoint, a couple unloading bags, {land}",
                   f"A rented motorhome in {name} (AI illustration)"))
for t, scene in TOPIC_ONLY.items():
    out.append(rec("topic", t, scene, f"{TOPIC[t][0]} (AI illustration)"))
for c, (name, land) in COUNTRY.items():
    for t, (title, tmpl) in TOPIC.items():
        out.append(rec("topic-country", f"{c}-{t}", tmpl.format(land=land),
                       f"{title} in {name} (AI illustration)"))
print(json.dumps(out, ensure_ascii=False, indent=1))
