use std::sync::Arc;
use std::time::Duration;
use reqwest::Client;
use tokio::sync::Semaphore;

/// Sci-Hub URL 检测器
pub struct SciHubAccessor {
    client: Client,
}

impl SciHubAccessor {
    pub fn new() -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap_or_default();

        SciHubAccessor { client }
    }

    /// 获取所有 Sci-Hub 域名列表
    fn get_scihub_domains() -> Vec<String> {
        vec![
            "sci-hub.se".to_string(),
            "sci-hub.st".to_string(),
            "sci-hub.ru".to_string(),
            "sci-hub.ren".to_string(),
            "sci-hub.shop".to_string(),
            "sci-hub.wf".to_string(),
            "sci-hub.ee".to_string(),
            "sci-hub.do".to_string(),
            "sci-hub.al".to_string(),
            "sci-hub.mk".to_string(),
            "sci-hub.box".to_string(),
            "sci-hub.in".to_string(),
            "sci-hub.cat".to_string(),
            "www.wellesu.com".to_string(),
            "www.pismin.com".to_string(),
            "www.tesble.com".to_string(),
            "sci-hub.usualwant.com".to_string(),
            "sci-hub.sidesgame.com".to_string(),
        ]
    }

    /// 测试单个 Sci-Hub 网址的可用性
    async fn test_scihub_url(&self, domain: &str) -> Option<String> {
        let url = format!("https://{}", domain);

        match self.client
            .get(&url)
            .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
            .send()
            .await
        {
            Ok(response) => {
                if response.status().is_success() {
                    match response.text().await {
                        Ok(html) => {
                            let html_lower = html.to_lowercase();
                            let indicators = ["sci-hub", "scihub", "research papers", "download"];
                            if indicators.iter().any(|&ind| html_lower.contains(ind)) {
                                return Some(url);
                            }
                        }
                        Err(_) => {}
                    }
                }
            }
            Err(_) => {}
        }

        None
    }

    /// 查找可用的 Sci-Hub 网址，找到指定数量后立即停止
    pub async fn find_available_urls(&self, limit: usize) -> Vec<String> {
        let domains = Self::get_scihub_domains();
        println!("正在检测可用的Sci-Hub网址，找到{}个后停止...", limit);

        let semaphore = Arc::new(Semaphore::new(10));
        let mut available_urls = Vec::new();

        let mut tasks = Vec::new();

        for domain in domains {
            if available_urls.len() >= limit {
                break;
            }

            let semaphore = Arc::clone(&semaphore);
            let client = self.client.clone();

            let task = tokio::spawn(async move {
                let _permit = semaphore.acquire().await.unwrap();

                let accessor = SciHubAccessor { client };
                if let Some(url) = accessor.test_scihub_url(&domain).await {
                    println!("✓ {}", url);
                    Some(url)
                } else {
                    println!("✗ https://{}", domain);
                    None
                }
            });

            tasks.push(task);
        }

        for task in tasks {
            if available_urls.len() >= limit {
                break;
            }
            if let Ok(Some(url)) = task.await {
                available_urls.push(url);
            }
        }

        if available_urls.is_empty() {
            println!("未找到可用的Sci-Hub网址");
        } else {
            println!("找到 {} 个可用网址:", available_urls.len());
            for (i, url) in available_urls.iter().enumerate() {
                println!("  {}. {}", i + 1, url);
            }
        }

        available_urls
    }

    /// 快速查找可用网址 - 找到指定数量后立即返回
    pub async fn fast_find_available_urls(&self, limit: usize) -> Vec<String> {
        let domains = vec![
            "sci-hub.se", "sci-hub.st", "sci-hub.ru",
            "sci-hub.ren", "sci-hub.shop", "sci-hub.wf",
            "sci-hub.ee", "sci-hub.do"
        ];

        println!("🚀 快速检测模式: 找到{}个可用网址即停止", limit);

        let semaphore = Arc::new(Semaphore::new(10));
        let mut available_urls = Vec::new();

        let mut tasks = Vec::new();

        for domain in domains {
            if available_urls.len() >= limit {
                break;
            }

            let semaphore = Arc::clone(&semaphore);
            let client = self.client.clone();

            let task = tokio::spawn(async move {
                let _permit = semaphore.acquire().await.unwrap();

                let accessor = SciHubAccessor { client };
                if let Some(url) = accessor.test_scihub_url(&domain).await {
                    println!("✓ {}", url);
                    Some(url)
                } else {
                    None
                }
            });

            tasks.push(task);
        }

        for task in tasks {
            if available_urls.len() >= limit {
                break;
            }
            if let Ok(Some(url)) = task.await {
                available_urls.push(url);
            }
        }

        available_urls
    }
}

impl Default for SciHubAccessor {
    fn default() -> Self {
        Self::new()
    }
}
