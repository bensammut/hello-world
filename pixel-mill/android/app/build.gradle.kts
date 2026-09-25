plugins {
    id("com.android.application")
}

android {
    namespace = "com.bensammut.pixelmill"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.bensammut.pixelmill"
        minSdk = 33 // Glyph Matrix SDK minimum
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation(files("libs/glyph-matrix-sdk-2.0.aar"))
    implementation("androidx.webkit:webkit:1.17.1")
}

// Build the Vite web app into assets/www before every Android build, so the APK always ships
// the current game. Runs through a login shell so npm is on PATH when launched from Android Studio.
val webRoot = rootProject.projectDir.parentFile
val buildWeb by tasks.registering(Exec::class) {
    description = "Builds the PIXEL MILL web app into app/src/main/assets/www"
    workingDir = webRoot
    commandLine("/bin/zsh", "-lc", "npm run build:android")
    inputs.dir(webRoot.resolve("src"))
    inputs.dir(webRoot.resolve("public"))
    inputs.files(webRoot.resolve("android.html"), webRoot.resolve("package.json"), webRoot.resolve("vite.config.ts"))
    outputs.dir(layout.projectDirectory.dir("src/main/assets/www"))
}
tasks.named("preBuild") { dependsOn(buildWeb) }
