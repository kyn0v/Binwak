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
   tab headers so their top spacing stays consistent. */
page {
  --header-top-gap: 20rpx;
}
</style>
