"""Seed 10 sample politicians and 10 news sources. Run: python seed/seed.py"""
from netanazar.db import DB

POLITICIANS = [
 ("Narendra Modi","नरेंद्र मोदी","Lok Sabha","Uttar Pradesh","Varanasi","BJP"),
 ("Rahul Gandhi","राहुल गांधी","Lok Sabha","Uttar Pradesh","Rae Bareli","INC"),
 ("Amit Shah","अमित शाह","Lok Sabha","Gujarat","Gandhinagar","BJP"),
 ("Rajnath Singh","राजनाथ सिंह","Lok Sabha","Uttar Pradesh","Lucknow","BJP"),
 ("Akhilesh Yadav","अखिलेश यादव","Lok Sabha","Uttar Pradesh","Kannauj","SP"),
 ("Mamata Banerjee","ममता बनर्जी","State Assembly","West Bengal","Bhabanipur","AITC"),
 ("Arvind Kejriwal","अरविंद केजरीवाल","State Assembly","Delhi","New Delhi","AAP"),
 ("Yogi Adityanath","योगी आदित्यनाथ","State Assembly","Uttar Pradesh",None,"BJP"),
 ("Asaduddin Owaisi","असदुद्दीन ओवैसी","Lok Sabha","Telangana","Hyderabad","AIMIM"),
 ("Nirmala Sitharaman","निर्मला सीतारमण","Rajya Sabha","Karnataka",None,"BJP"),
]
SOURCES = [
 ("thehindu.com","The Hindu",["https://www.thehindu.com/news/national/feeder/default.rss"]),
 ("indianexpress.com","Indian Express",["https://indianexpress.com/section/india/feed/"]),
 ("ndtv.com","NDTV",["https://feeds.feedburner.com/ndtvnews-india-news"]),
 ("hindustantimes.com","Hindustan Times",["https://www.hindustantimes.com/feeds/rss/india-news/rssfeed.xml"]),
 ("timesofindia.indiatimes.com","Times of India",["https://timesofindia.indiatimes.com/rssfeeds/-2128936835.cms"]),
 ("livemint.com","Mint",["https://www.livemint.com/rss/news"]),
 ("scroll.in","Scroll",["https://feeds.feedburner.com/ScrollinArticles.rss"]),
 ("theprint.in","ThePrint",["https://theprint.in/feed/"]),
 ("thewire.in","The Wire",["https://thewire.in/rss"]),
 ("jagran.com","Dainik Jagran",[]),
]

db = DB()
db.insert("politicians", [{"name_en": n, "name_hi": h, "house": ho, "state": st, "constituency": c, "party": pa,
                           "name_variants": []} for n, h, ho, st, c, pa in POLITICIANS])
db.insert("sources", [{"domain": d, "name": n, "rss_urls": r} for d, n, r in SOURCES],
          on_conflict="domain", ignore_duplicates=True)
print("seeded")
