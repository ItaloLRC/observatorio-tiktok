CREATE TABLE channels (
 id TEXT PRIMARY KEY, platform TEXT NOT NULL DEFAULT 'tiktok', handle TEXT NOT NULL COLLATE NOCASE,
 canonical_url TEXT NOT NULL, platform_id TEXT, sec_uid TEXT, display_name TEXT, bio TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_crawled_at TEXT,
 coverage TEXT NOT NULL DEFAULT 'unknown', UNIQUE(platform,handle)
);
--> statement-breakpoint
CREATE TABLE crawl_jobs (
 id TEXT PRIMARY KEY, channel_id TEXT NOT NULL REFERENCES channels(id), provider TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('queued','running','completed','partial','blocked','cancelled','imported')),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, finished_at TEXT,
 include_comments INTEGER NOT NULL DEFAULT 1, discovered_videos INTEGER NOT NULL DEFAULT 0,
 saved_comments INTEGER NOT NULL DEFAULT 0, processed_tasks INTEGER NOT NULL DEFAULT 0,
 videos_complete INTEGER NOT NULL DEFAULT 0, comments_complete INTEGER NOT NULL DEFAULT 0,
 message TEXT, lock_token TEXT, lock_until TEXT, options_json TEXT NOT NULL DEFAULT '{}'
);
--> statement-breakpoint
CREATE UNIQUE INDEX one_active_crawl_per_channel ON crawl_jobs(channel_id) WHERE status IN ('queued','running');
--> statement-breakpoint
CREATE TABLE channel_snapshots (
 id TEXT PRIMARY KEY, channel_id TEXT NOT NULL REFERENCES channels(id), job_id TEXT NOT NULL REFERENCES crawl_jobs(id),
 captured_at TEXT NOT NULL, followers INTEGER, following INTEGER, likes INTEGER, video_count INTEGER,
 counts_approximate INTEGER NOT NULL DEFAULT 0, raw_json TEXT, UNIQUE(channel_id,job_id)
);
--> statement-breakpoint
CREATE TABLE videos (
 id TEXT PRIMARY KEY, channel_id TEXT NOT NULL REFERENCES channels(id), canonical_url TEXT NOT NULL,
 title TEXT, description TEXT, series TEXT, published_at TEXT, timestamp_source TEXT NOT NULL DEFAULT 'unknown',
 published_brt TEXT, hour_brt INTEGER, weekday_brt INTEGER, day_of_month_brt INTEGER, month_brt INTEGER, year_brt INTEGER,
 duration_seconds REAL, width INTEGER, height INTEGER, music_id TEXT, music_title TEXT, music_author TEXT,
 language TEXT, region TEXT, is_ad INTEGER, is_ai_generated INTEGER,
 first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, raw_json TEXT
);
--> statement-breakpoint
CREATE INDEX videos_by_channel_time ON videos(channel_id,published_at);
--> statement-breakpoint
CREATE TABLE video_snapshots (
 id TEXT PRIMARY KEY, video_id TEXT NOT NULL REFERENCES videos(id), job_id TEXT NOT NULL REFERENCES crawl_jobs(id),
 captured_at TEXT NOT NULL, views INTEGER, likes INTEGER, comment_count INTEGER, shares INTEGER, reposts INTEGER,
 saves INTEGER, downloads INTEGER, counts_approximate INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL,
 raw_json TEXT, UNIQUE(video_id,job_id)
);
--> statement-breakpoint
CREATE INDEX snapshots_by_video_time ON video_snapshots(video_id,captured_at);
--> statement-breakpoint
CREATE TABLE hashtags (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE);
--> statement-breakpoint
CREATE TABLE video_hashtags (
 video_id TEXT NOT NULL REFERENCES videos(id), hashtag_id TEXT NOT NULL REFERENCES hashtags(id),
 first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(video_id,hashtag_id)
);
--> statement-breakpoint
CREATE TABLE video_snapshot_hashtags (
 snapshot_id TEXT NOT NULL REFERENCES video_snapshots(id), hashtag_id TEXT NOT NULL REFERENCES hashtags(id),
 PRIMARY KEY(snapshot_id,hashtag_id)
);
--> statement-breakpoint
CREATE TABLE comments (
 id TEXT PRIMARY KEY, video_id TEXT NOT NULL REFERENCES videos(id), parent_comment_id TEXT REFERENCES comments(id) DEFERRABLE INITIALLY DEFERRED,
 author_platform_id TEXT, author_handle TEXT, text TEXT, created_at TEXT, language TEXT,
 first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, raw_json TEXT
);
--> statement-breakpoint
CREATE INDEX comments_by_video_parent ON comments(video_id,parent_comment_id);
--> statement-breakpoint
CREATE TABLE comment_snapshots (
 id TEXT PRIMARY KEY, comment_id TEXT NOT NULL REFERENCES comments(id), job_id TEXT NOT NULL REFERENCES crawl_jobs(id),
 captured_at TEXT NOT NULL, likes INTEGER, reply_count INTEGER, raw_json TEXT, UNIQUE(comment_id,job_id)
);
--> statement-breakpoint
CREATE TABLE crawl_tasks (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES crawl_jobs(id), kind TEXT NOT NULL,
 target_id TEXT NOT NULL DEFAULT '', cursor TEXT NOT NULL DEFAULT '0', payload_json TEXT NOT NULL DEFAULT '{}',
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','done','failed')),
 attempts INTEGER NOT NULL DEFAULT 0, retry_at TEXT, error TEXT, created_at TEXT NOT NULL, completed_at TEXT,
 UNIQUE(job_id,kind,target_id,cursor)
);
--> statement-breakpoint
CREATE INDEX tasks_by_job_status ON crawl_tasks(job_id,status,retry_at);
--> statement-breakpoint
CREATE TABLE crawl_events (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES crawl_jobs(id), level TEXT NOT NULL,
 code TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE imports (id TEXT PRIMARY KEY, imported_at TEXT NOT NULL, channel_id TEXT NOT NULL REFERENCES channels(id));
--> statement-breakpoint
CREATE VIEW latest_video_metrics AS
SELECT v.*,s.captured_at,s.views,s.likes,s.comment_count,s.shares,s.reposts,s.saves,s.downloads,s.counts_approximate,s.source,
 (SELECT COUNT(*) FROM video_hashtags vh WHERE vh.video_id=v.id AND vh.active=1) AS hashtag_count,
 CASE WHEN s.views>0 AND s.likes IS NOT NULL THEN s.likes*1.0/s.views END AS like_view_ratio,
 CASE WHEN s.comment_count>0 AND s.likes IS NOT NULL THEN s.likes*1.0/s.comment_count END AS video_likes_per_comment,
 CASE WHEN s.views>0 AND s.comment_count IS NOT NULL THEN s.comment_count*1.0/s.views END AS comment_view_ratio,
 CASE WHEN s.views>0 AND s.shares IS NOT NULL THEN s.shares*1.0/s.views END AS share_view_ratio,
 (SELECT COUNT(*) FROM comments c WHERE c.video_id=v.id AND c.raw_json IS NOT NULL) AS comments_loaded
FROM videos v LEFT JOIN video_snapshots s ON s.id=(SELECT ss.id FROM video_snapshots ss WHERE ss.video_id=v.id ORDER BY ss.captured_at DESC,ss.rowid DESC LIMIT 1);
