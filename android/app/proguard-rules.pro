# Compose, Activity Result and lifecycle publish their own consumer rules.
# Public providers, services and receivers referenced in AndroidManifest are kept by AGP.
# This app uses explicit JSON fields and does not reflect over obfuscated data classes.
-keepattributes Signature,InnerClasses,EnclosingMethod

# WebRTC's native library calls Java by fully qualified JNI names. This AAR does
# not include consumer rules; preserve them in release as well as debug builds.
-keep class org.webrtc.** { *; }
-keepattributes RuntimeVisibleAnnotations,RuntimeInvisibleAnnotations

# 6.1 小组件：Glance 按类名反射创建点击回调
-keep class * implements androidx.glance.appwidget.action.ActionCallback { <init>(); }
# 正式版压缩时，忽略可选依赖的缺失提示（OkHttp 的可选 TLS 库、注解）
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
-dontwarn javax.annotation.**
-dontwarn kotlinx.coroutines.debug.**
