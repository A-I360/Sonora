#!/usr/bin/env bash
# Sonora end-to-end API test. Requires the server on $B.
B=${B:-localhost:3000}
CK=/tmp/e2e.txt
CK2=/tmp/e2e2.txt
rm -f $CK $CK2
pass=0; fail=0
chk() {
  if echo "$2" | grep -q "$3"; then
    echo "  ok  $1"; pass=$((pass+1))
  else
    echo "  FAIL $1 -> $(echo "$2" | head -c 200)"; fail=$((fail+1))
  fi
}
jq_() { python3 -c "import sys,json;d=json.load(sys.stdin);print($1)"; }

SUF=$RANDOM
echo "== AUTH =="
r=$(curl -s -c $CK -X POST $B/api/auth/register -H 'Content-Type: application/json' -d "{\"email\":\"e2e$SUF@sonora.fm\",\"password\":\"password123\",\"displayName\":\"E2E Tester\"}")
chk "register" "$r" '"handle"'
r=$(curl -s -X POST $B/api/auth/register -H 'Content-Type: application/json' -d "{\"email\":\"e2e$SUF@sonora.fm\",\"password\":\"password123\"}")
chk "duplicate email rejected" "$r" 'already exists'
r=$(curl -s -X POST $B/api/auth/register -H 'Content-Type: application/json' -d '{"email":"bad","password":"password123"}')
chk "invalid email rejected" "$r" 'valid email'
r=$(curl -s -X POST $B/api/auth/register -H 'Content-Type: application/json' -d '{"email":"x@y.com","password":"short"}')
chk "short password rejected" "$r" 'at least 8'
r=$(curl -s -X POST $B/api/auth/login -H 'Content-Type: application/json' -d "{\"email\":\"e2e$SUF@sonora.fm\",\"password\":\"WRONG\"}")
chk "wrong password rejected" "$r" 'incorrect'
r=$(curl -s $B/api/playlists)
chk "unauthenticated blocked" "$r" 'sign in'

echo "== SEARCH =="
r=$(curl -s -b $CK "$B/api/search?q=wizkid&limit=5")
chk "search returns tracks" "$r" '"tracks"'
TRACK=$(echo "$r" | jq_ "json.dumps(d['tracks'][0])")
TID=$(echo "$TRACK" | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
TIDQ=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$TID")
echo "  -> seed track $TID"

echo "== PLAYLIST CRUD =="
r=$(curl -s -b $CK -X POST $B/api/playlists -H 'Content-Type: application/json' -d '{"name":"My Mix","description":"test","isPublic":true}')
chk "create" "$r" '"My Mix"'
PID=$(echo "$r" | jq_ "d['playlist']['id']")
r=$(curl -s -b $CK -X POST $B/api/playlists -H 'Content-Type: application/json' -d '{"name":""}')
chk "empty name rejected" "$r" 'required'
r=$(curl -s -b $CK $B/api/playlists/$PID)
chk "read" "$r" '"My Mix"'
r=$(curl -s -b $CK -X PATCH $B/api/playlists/$PID -H 'Content-Type: application/json' -d '{"name":"Renamed Mix","isPublic":false}')
chk "update" "$r" 'Renamed Mix'
r=$(curl -s -b $CK -X POST $B/api/playlists/$PID/tracks -H 'Content-Type: application/json' -d "{\"track\":$TRACK}")
chk "add track" "$r" '"trackCount":1'
r=$(curl -s -b $CK -X POST $B/api/playlists/$PID/tracks -H 'Content-Type: application/json' -d "{\"track\":$TRACK}")
chk "duplicate track rejected" "$r" 'already in'

T2=$(curl -s -b $CK "$B/api/search?q=tems&limit=3" | jq_ "json.dumps(d['tracks'][0])")
T3=$(curl -s -b $CK "$B/api/search?q=davido&limit=3" | jq_ "json.dumps(d['tracks'][0])")
curl -s -b $CK -X POST $B/api/playlists/$PID/tracks -H 'Content-Type: application/json' -d "{\"track\":$T2}" > /dev/null
r=$(curl -s -b $CK -X POST $B/api/playlists/$PID/tracks -H 'Content-Type: application/json' -d "{\"track\":$T3}")
chk "three tracks" "$r" '"trackCount":3'
ROW=$(echo "$r" | jq_ "d['playlist']['tracks'][2]['rowId']")
r=$(curl -s -b $CK -X PATCH $B/api/playlists/$PID/tracks/$ROW -H 'Content-Type: application/json' -d '{"position":0}')
FIRST=$(echo "$r" | jq_ "d['playlist']['tracks'][0]['rowId']")
if [ "$FIRST" = "$ROW" ]; then echo "  ok  reorder to position 0"; pass=$((pass+1)); else echo "  FAIL reorder"; fail=$((fail+1)); fi
r=$(curl -s -b $CK -X DELETE $B/api/playlists/$PID/tracks/$ROW)
chk "remove track" "$r" '"trackCount":2'

echo "== LIBRARY =="
r=$(curl -s -b $CK -X POST $B/api/library -H 'Content-Type: application/json' -d "{\"track\":$TRACK}")
chk "save track" "$r" '"saved":true'
r=$(curl -s -b $CK $B/api/library)
chk "list library" "$r" "$TID"
r=$(curl -s -b $CK -X DELETE "$B/api/library/$TIDQ")
chk "unsave" "$r" '"saved":false'

echo "== SHARES + COMMENTS =="
r=$(curl -s -b $CK -X POST $B/api/shares -H 'Content-Type: application/json' -d "{\"track\":$TRACK,\"message\":\"This slaps\"}")
chk "create share" "$r" 'This slaps'
SID=$(echo "$r" | jq_ "d['share']['id']")
r=$(curl -s -b $CK -X PATCH $B/api/shares/$SID -H 'Content-Type: application/json' -d '{"message":"Edited take"}')
chk "edit share" "$r" 'Edited take'
r=$(curl -s -b $CK -X POST $B/api/shares/$SID/comments -H 'Content-Type: application/json' -d '{"body":"Agreed!"}')
chk "create comment" "$r" 'Agreed'
CID=$(echo "$r" | jq_ "d['comment']['id']")
r=$(curl -s -b $CK -X PATCH $B/api/comments/$CID -H 'Content-Type: application/json' -d '{"body":"Totally agreed"}')
chk "edit comment" "$r" 'Totally agreed'
r=$(curl -s -b $CK $B/api/shares/$SID/comments)
chk "list comments" "$r" 'Totally agreed'
r=$(curl -s -b $CK -X POST $B/api/likes -H 'Content-Type: application/json' -d "{\"targetType\":\"share\",\"targetId\":\"$SID\"}")
chk "like share" "$r" '"liked":true'
r=$(curl -s -b $CK -X POST $B/api/likes -H 'Content-Type: application/json' -d "{\"targetType\":\"share\",\"targetId\":\"$SID\"}")
chk "unlike toggles" "$r" '"liked":false'
r=$(curl -s -b $CK -X DELETE $B/api/comments/$CID)
chk "delete comment" "$r" '"ok":true'

echo "== AI =="
r=$(curl -s -b $CK -X POST $B/api/ai/playlist -H 'Content-Type: application/json' -d '{"prompt":"moody late night amapiano","limit":8}')
chk "ai playlist" "$r" '"tracks"'
echo "  -> $(echo "$r" | jq_ "str(len(d['tracks']))+' tracks, name: '+d['name']")"
r=$(curl -s -b $CK -X POST $B/api/ai/similar -H 'Content-Type: application/json' -d "{\"track\":$TRACK,\"limit\":5}")
chk "ai similar" "$r" '"tracks"'
r=$(curl -s -b $CK $B/api/ai/recommendations)
chk "ai recommendations" "$r" '"profile"'

echo "== OWNERSHIP =="
curl -s -c $CK2 -X POST $B/api/auth/register -H 'Content-Type: application/json' -d "{\"email\":\"mal$SUF@sonora.fm\",\"password\":\"password123\",\"displayName\":\"Mallory\"}" > /dev/null
r=$(curl -s -b $CK2 -X PATCH $B/api/playlists/$PID -H 'Content-Type: application/json' -d '{"name":"HACKED"}')
chk "cannot edit others playlist" "$r" 'belongs to someone else'
r=$(curl -s -b $CK2 -X DELETE $B/api/shares/$SID)
chk "cannot delete others post" "$r" 'only delete your own'
r=$(curl -s -b $CK2 $B/api/playlists/$PID)
chk "private playlist hidden" "$r" 'private'

echo "== PLAYS + STATS =="
curl -s -b $CK -X POST $B/api/plays -H 'Content-Type: application/json' -d "{\"track\":$TRACK,\"ms\":30000}" > /dev/null
r=$(curl -s -b $CK $B/api/stats)
chk "stats" "$r" '"plays":1'
r=$(curl -s -b $CK $B/api/plays/recent)
chk "recent plays" "$r" "$TID"

echo "== PROFILE =="
r=$(curl -s -b $CK -X PATCH $B/api/me -H 'Content-Type: application/json' -d '{"displayName":"Renamed User","bio":"I love afrobeats"}')
chk "update profile" "$r" 'Renamed User'
r=$(curl -s -b $CK2 -X PATCH $B/api/me -H 'Content-Type: application/json' -d '{"handle":"e2etester"}')
chk "duplicate handle rejected" "$r" 'taken'

echo "== DELETE + LOGOUT =="
r=$(curl -s -b $CK -X DELETE $B/api/shares/$SID)
chk "delete share" "$r" '"ok":true'
r=$(curl -s -b $CK -X DELETE $B/api/playlists/$PID)
chk "delete playlist" "$r" '"ok":true'
r=$(curl -s -b $CK $B/api/playlists/$PID)
chk "404 after delete" "$r" 'not found'
r=$(curl -s -b $CK -X POST $B/api/auth/logout)
chk "logout" "$r" '"ok":true'
r=$(curl -s -b $CK $B/api/playlists)
chk "session invalidated" "$r" 'sign in'

echo
echo "PASS=$pass FAIL=$fail"
[ $fail -eq 0 ]
