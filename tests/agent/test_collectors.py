from mirkomil import collectors as c

STAT_1 = "cpu  100 0 50 800 50 0 0 0 0 0\ncpu0 1 0 0 1 0 0 0 0 0 0\n"
STAT_2 = "cpu  200 0 100 1100 100 0 0 0 0 0\n"

MEMINFO = """MemTotal:        8000000 kB
MemFree:          500000 kB
MemAvailable:    6000000 kB
SwapTotal:       2000000 kB
SwapFree:        1500000 kB
HugePages_Total:       0
"""

NETDEV = """Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 999 0 0 0 0 0 0 0 999 0 0 0 0 0 0 0
  eth0: 1000 0 0 0 0 0 0 0 300 0 0 0 0 0 0 0
docker0: 5000 0 0 0 0 0 0 0 5000 0 0 0 0 0 0 0
vethab12: 7000 0 0 0 0 0 0 0 7000 0 0 0 0 0 0 0
  wlan0: 24 0 0 0 0 0 0 0 76 0 0 0 0 0 0 0
"""


def test_cpu_percent_from_two_samples():
    a, b = c.read_cpu_times(STAT_1), c.read_cpu_times(STAT_2)
    total = (200 + 100 + 1100 + 100) - (100 + 50 + 800 + 50)
    idle = (1100 + 100) - (800 + 50)
    assert abs(c.cpu_percent(a, b) - (1 - idle / total) * 100) < 1e-9


def test_cpu_percent_no_time_passed():
    a = c.read_cpu_times(STAT_1)
    assert c.cpu_percent(a, a) is None


def test_meminfo_used_is_total_minus_available():
    m = c.meminfo(MEMINFO)
    assert m["total"] == 8000000 * 1024
    assert m["used"] == (8000000 - 6000000) * 1024
    assert m["swap_used"] == 500000 * 1024


def test_net_bytes_skips_virtual_interfaces():
    assert c.net_bytes(NETDEV) == (1000 + 24, 300 + 76)
