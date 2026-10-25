#!/bin/bash
# Local VM build (Java localhost TCP is policy-blocked -> Gradle must run
# in-process: client JVM flags mirror org.gradle.jvmargs exactly, incl.
# locale props + instrumentation agent, so no single-use daemon is forked.
# Direct egress works because other_tcp=Ask; no proxy for Gradle.)
export JAVA_HOME=$HOME/workspace/tools/jdk-21.0.12.1+1
export ANDROID_HOME=$HOME/workspace/tools/android-sdk
export GRADLE_USER_HOME=$HOME/workspace/.gradle-home
export PATH=$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH
cd $HOME/workspace/kharuimusic/android
$JAVA_HOME/bin/java -Xmx2g -Dfile.encoding=UTF-8 -Duser.country=US -Duser.language=en -Duser.variant= \
  -javaagent:$HOME/workspace/tools/gradle-8.14.3/lib/agents/gradle-instrumentation-agent-8.14.3.jar \
  -cp "$HOME/workspace/tools/gradle-8.14.3/lib/*" \
  org.gradle.launcher.GradleMain assembleDebug --no-daemon "$@"
