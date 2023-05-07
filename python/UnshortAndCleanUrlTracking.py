import sys
import unalix

url = sys.argv[1]
result: str = unalix.unshort_url(url=url)

print(result)
sys.stdout.flush()
