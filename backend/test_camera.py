import requests
try:
    r = requests.get("http://172.16.14.159:8081/video", stream=True, timeout=5)
    print("Status code:", r.status_code)
except Exception as e:
    print("Error:", e)


