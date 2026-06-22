<script setup lang="ts">
import { onLaunch, onShow, onHide } from "@dcloudio/uni-app";
onLaunch(() => {
  console.log("App Launch");
});
onShow(() => {
  console.log("App Show");
});
onHide(() => {
  console.log("App Hide");
});
</script>
<style>
/* Global design tokens.
   --header-top-gap: breathing space between the WeChat capsule inset and the
   first row of content. Single source of truth for the home / plaza / profile
   tab headers so their top spacing stays consistent.
   --tabbar-content-height: the custom TabBar's height excluding the bottom
   safe-area inset (inner 76rpx + vertical padding 2*16rpx = 108rpx). Matches
   the innerRpx+paddingRpx defaults in utils/layout.ts tabbarHeight(). Fixed
   bottom panels reserve this much space (plus env(safe-area-inset-bottom)) so
   they clear the TabBar. Single source of truth shared across pages. */
page {
  --header-top-gap: 20rpx;
  --tabbar-content-height: 108rpx;
}
</style>
