const SCRAPER_CONFIGS = {
  sohu: {
    BATCH_SIZE: 50,
    MAX_RETRIES: 3,
    TARGET_URL: 'https://www.sohu.com/',
    LINKS_SELECTOR: 'ul.news[data-spm="top-news1"] a.titleStyle',
    DETAILS_SELECTORS: {
      title: 'h1',
      time: 'span#news-time',
      location: 'div.area > span:last-child',
      image: 'img',
      description: 'meta[name="description"]'
    },
    CUSTOM_TIMEOUTS: {
      BATCH_DELAY: 2000
    }
  },

  gamelook: {
    BATCH_SIZE: 50,
    MAX_RETRIES: 3,
    START_PAGE: 1,
    END_PAGE: 2,
    BASE_URL: 'http://www.gamelook.com.cn',
    PAGE_URL_TEMPLATE: 'http://www.gamelook.com.cn/page/{page}/',
    LINKS_SELECTOR: 'h2.item-title a',
    DETAILS_SELECTORS: {
      title: 'h1',
      image: 'div.entry img',
      postingdate: 'span',
      description: 'meta[name="description"]'
    },
    CUSTOM_TIMEOUTS: {
      PAGE_LOAD: 300000,
      DETAIL_LOAD: 300000,
      WAIT_AFTER_DETAIL: 5000,
      BATCH_DELAY: 2000
    }
  },

  '9game': {
    BATCH_SIZE: 20,
    MAX_RETRIES: 3,
    TARGET_URL: 'https://www.9game.cn/xyrb/?spm=aligames_platform_ug.ng_seo.0.0.36d769b18t8wzl',
    RANKING_SELECTORS: {
      rank: 'td.num span.n',
      link: 'td.name a'
    },
    DETAILS_SELECTORS: {
      released: {
        namegame: [
          'div[class^="ng-pc-materials__topbanner--title"]',
          'h1.tit.cn',
          'a[data-spm-protocol][data-spm-anchor-id]:not([href*="tag"])'
        ],
        day: 'div[class^="ng-pc-materials__topbanner--timeline_content_small"]',
        anh: 'img[class*="ng-pc-materials__topbanner--icon_game"]',
        theloai: 'div[class^="ng-pc-materials__topbanner--tag_text"]',
        description: 'div.ng-pc-materials__topbanner--description_box_small--3ImkWfE'
      },
      unreleased: {
        namegame: 'h1.ngame-title a',
        day: 'div[class^="ng-pc-materials__topbanner--timeline_content_small"]',
        anh: 'ul.focus-img li[style*="display: list-item"] img',
        theloai: 'div.ngame-types span.point',
        description: 'div.ng-pc-materials__topbanner--description_box_small--3ImkWfE'
      }
    },
    CUSTOM_TIMEOUTS: {
      PAGE_LOAD: 300000,
      DETAIL_LOAD: 300000,
      BATCH_DELAY: 2000
    }
  },

  gnn: {
    BATCH_SIZE: 25,
    MAX_RETRIES: 3,
    CATEGORIES: [
      { url: 'https://gnn.gamer.com.tw/index.php?k=4', source: '手機' },
      { url: 'https://gnn.gamer.com.tw/index.php?k=1', source: 'PC' },
      { url: 'https://gnn.gamer.com.tw/index.php?k=3', source: 'TV 掌機' },
      { url: 'https://gnn.gamer.com.tw/index.php?k=5', source: '動漫畫' },
      { url: 'https://gnn.gamer.com.tw/index.php?k=13', source: '電競' },
      { url: 'https://gnn.gamer.com.tw/index.php?k=11', source: '活動展覽' },
      { url: 'https://gnn.gamer.com.tw/index.php?k=9', source: '主題報導' }
    ],
    LINKS_SELECTOR: 'a[href*="gnn.gamer.com.tw/detail.php?sn="]',
    CUSTOM_TIMEOUTS: {
      PAGE_LOAD: 60000
    }
  }
};

module.exports = SCRAPER_CONFIGS;