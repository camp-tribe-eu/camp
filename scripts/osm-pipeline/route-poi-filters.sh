# shellcheck shell=bash
# The tag list the route-POI layer is cut by — ONE copy, sourced by both
# scripts that hand it to osmium:
#
#   load-route-poi.sh      the by-hand path: 27 PBFs on a machine → staging
#   extract-route-poi.sh   the weekly path: one PBF on a runner → release asset
#
# 🔴 WHY A FILE OF ITS OWN. extract-campsites.sh's header records what two
# copies of one filter cost: the duplicate-node fix landed in the copy that
# does not ship, and review reproduced the unfixed state on Austria three
# days after "fixed". The weekly route-POI build (this card) would have been
# the second copy of THIS list. Sourced from here, there is one.
#
# 🔴 It must stay identical to STORED_POI_RULES in
# apps/api/src/osm/route-poi.ts (CAMP-119: every kind the table can hold,
# not only the nine a route page shows — `shop=gas` is the tenth, CAMP-258 —
# apps/api/src/routes/route-services.spec.ts reads this array and compares).
# `amenity=parking` is deliberately NOT here: 3.1 million objects, and a
# separate conversation. A tag filtered here and not classified there is a
# row loaded and thrown away; a tag classified there and not filtered here
# is a kind that silently holds nothing — which is the failure that does not
# announce itself. `load-route-poi.ts` fails if any kind ends up empty, which
# is the check that catches both directions.
#
# 🔴 CAMP-327: PLAIN `key=value` PAIRS HERE, AND THE SUBSTRING FORM IN ONE
# PLACE BELOW. Every rule reads its key as a `;` list (`amenity=restaurant;
# ice_cream` is a restaurant), osmium compares the WHOLE value, so every
# value has to be asked for as `key=*value*`. It used to be written out by
# hand for one entry (`'shop=*gas*'`) and as an equality for the other
# seventeen — which is how 30 objects of the Austrian extract alone (`tourism=
# hotel;camp_site` among them) never reached staging. Written once, in the
# loop, the form cannot differ between entries; the spec compares the PAIRS
# with STORED_POI_RULES and load-route-poi.selftest.sh checks what osmium is
# actually handed.
#
# The pairs are indented by exactly two spaces: that is the shape the spec's
# regex reads (`^\s{2}([a-z_]+=[a-z_]+)`), so a pair written otherwise is a
# pair the spec does not see.
FILTERS=(
  amenity=fuel
  amenity=charging_station
  amenity=drinking_water
  amenity=water_point
  man_made=water_tap
  amenity=sanitary_dump_station
  highway=rest_area
  highway=services
  shop=gas
  shop=supermarket
  shop=convenience
  amenity=restaurant
  amenity=cafe
  amenity=fast_food
  tourism=hotel
  tourism=motel
  tourism=hostel
  tourism=guest_house
)

TAG_ARGS=()
for f in "${FILTERS[@]}"; do
  # Nodes AND ways: a supermarket and a motorway services are usually
  # areas, and "the nearest shop" that skipped every building would be
  # wrong in a way nobody would spot from the page.
  #
  # 🔴 The `*`s sit inside double quotes: an unquoted `*` is a glob over
  # the working directory, and a file called `shop=xgas` there would
  # replace the filter with its own name, silently, with exit 0
  # (load-route-poi.selftest.sh plants such a file). `${f%%=*}` is the
  # key, `${f#*=}` the value.
  TAG_ARGS+=("n/${f%%=*}=*${f#*=}*" "w/${f%%=*}=*${f#*=}*")
done
