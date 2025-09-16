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
    BATCH_SIZE: 10,
    MAX_RETRIES: 3,
    TARGET_URL: 'https://www.9game.cn/xyrb/?spm=aligames_platform_ug.ng_seo.0.0.36d769b18t8wzl',
    RANKING_SELECTORS: {
      table_indicator: 'div.box-text',
      table_container: 'div.box-text table tbody',
      rank_cell: 'td.num span',
      link_cell: 'td.name a'
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
        description: [
          'div.ng-pc-materials__topbanner--description_box_small--3ImkWfE',
          'div.ngame-desc',
          'div[class*="description"]',
          'div.game-desc',
          'div.desc',
          'meta[name="description"]'
        ]
      },
      unreleased: {
        namegame: 'h1.ngame-title a',
        day: 'div[class^="ng-pc-materials__topbanner--timeline_content_small"]',
        anh: 'ul.focus-img li[style*="display: list-item"] img',
        theloai: 'div.ngame-types span.point',
        description: [
          'div.ngame-desc',
          'div.ng-pc-materials__topbanner--description_box_small--3ImkWfE',
          'div[class*="description"]',
          'div.game-desc',
          'div.desc',
          'meta[name="description"]'
        ]
      }
    },
    CUSTOM_TIMEOUTS: {
      PAGE_LOAD: 60000,
      DETAIL_LOAD: 60000,
      WAIT_AFTER_LOAD: 5000,
      WAIT_AFTER_DETAIL: 5000,
      BATCH_DELAY: 500,
      SMART_WAIT_MAX: 30000,
      POLL_INTERVAL: 1000
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
  },

  taptap: {
    BATCH_SIZE: 20,
    MAX_RETRIES: 3,
    TARGET_URLS: [
      { url: 'https://www.taptap.cn/top/download?os=pc', source: 'download' },
      { url: 'https://www.taptap.cn/top/reserve?os=pc', source: 'reserve' }
    ],
    TARGET_RANK: 50,
    ITEMS_PER_SCROLL: 10,
    GAME_CONTAINER_SELECTOR: 'div.list-item',
    TARGET_PAGE: 5,
    SCROLL_TO_PAGE: 6,
    RANKING_SELECTORS: {
      rank: 'span[class*="data-v-ea802df3"]',
      title: 'div.text-with-tags.app-title span',
      rating: 'div.tap-rating__number.rate-number-font',
      category_primary: 'div.tap-text.tap-text__one-line.caption-m12-w12.gray-06.app-row-card__hint',
      category_tags: 'div.tap-label-tag-group.flex.tap-ellipsis.group--adjust.game-cell__tags a',
      game_link: 'a.tap-router.tap-router__prefetched.inline-flex.game-cell__icon',
      image: 'a.tap-router.tap-router__prefetched.inline-flex.game-cell__icon div.tap-image-wrapper.app-icon.tap-avatar.tap-avatar--small.app-icon__img-hover img',
      image_fallback: 'img[data-v-b7568bee].tap-image.app-icon__img'
    },
    DETAILS_SELECTORS: {
      release_date: 'div.tap-text.tap-text__one-line.single-info__content__value.gray-07[data-v-0e365061]',
      developer: {
        container: 'div.row-card__content div.app-intro__item',
        wrapper_div: 'div.flex-center--y[data-v-c22f6d57=""]',
        link_selector: 'a.tap-router.tap-router__prefetched.flex-center--y.mb-6',
        label_text: '开发'
      },
      publisher: {
        container: 'div.row-card__content div.app-intro__item',
        wrapper_div: 'div.flex-center--y[data-v-c22f6d57=""]',
        link_selector: 'a.tap-router.tap-router__prefetched.flex-center--y.mb-6',
        label_text: '发行'
      },
      manufacturer: {
        container: 'div.row-card__content div.app-intro__item',
        wrapper_div: 'div.flex-center--y[data-v-c22f6d57=""]',
        link_selector: 'a.tap-router.tap-router__prefetched.flex-center--y.mb-6',
        label_text: '厂商'
      },
      supplier: {
        container: 'div.row-card__content div.app-intro__item',
        text_container: 'div[data-v-cd2f7eea][data-v-c22f6d57].tap-text.tap-text__multi-line.flex.mt-6',
        supplier_info: 'div[data-v-cd2f7eea].flex-center--y.privacy-policy-info.caption-m10-w12.gray-06',
        label_text: '供应商'
      }
    },
    INFINITE_SCROLL: {
      SCROLL_DELAY: 2000,
      WAIT_FOR_LOAD: 1000,
      MAX_SCROLL_ATTEMPTS: 50,
      FAST_SCROLL_PIXELS: 300
    },
    CUSTOM_TIMEOUTS: {
      PAGE_LOAD: 600000,
      WAIT_AFTER_LOAD: 15000,
      SCROLL_TIMEOUT: 30000,
      RETRY_DELAY: 5000,
      DETAIL_LOAD: 600000,
      WAIT_AFTER_DETAIL: 8000,
      BATCH_DELAY: 3000
    }
  }
};

module.exports = SCRAPER_CONFIGS;