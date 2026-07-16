require 'xcodeproj'
project=Xcodeproj::Project.new('Omodesu.xcodeproj')
project.build_configuration_list.build_configurations.each{|c| c.build_settings['MACOSX_DEPLOYMENT_TARGET']='14.0';c.build_settings['IPHONEOS_DEPLOYMENT_TARGET']='17.0'}
group=project.main_group.new_group('Apple','Apple'); app=group.new_group('App','App'); shared=group.new_group('Shared','Shared/Sources/OmodesuShared'); scripts=group.new_group('scripts','Apple/scripts')
source=app.new_file('OmodesuApp.swift'); macEnt=app.new_file('Mac.entitlements'); iosEnt=app.new_file('iOS.entitlements'); package=shared.new_file('OmodesuShared.swift'); script=scripts.new_file('build-sidecar.sh'); verify=scripts.new_file('verify-signing.sh')
mac=project.new_target(:application,'OmodesuMac',:osx,'14.0'); ios=project.new_target(:application,'OmodesuIOS',:ios,'17.0')
[mac,ios].each do|target|
 target.add_file_references([source,package]); target.build_configurations.each do|c|
  c.build_settings['SWIFT_VERSION']='6.0';c.build_settings['PRODUCT_BUNDLE_IDENTIFIER']=target==mac ? 'com.ilseoblee.omodesu.mac':'com.ilseoblee.omodesu.ios';c.build_settings['DEVELOPMENT_TEAM']='U48VX8D6WT';c.build_settings['CODE_SIGN_STYLE']='Automatic';c.build_settings['GENERATE_INFOPLIST_FILE']='YES';c.build_settings['INFOPLIST_KEY_CFBundleDisplayName']='Omodesu'
 end
end
mac.build_configurations.each{|c|c.build_settings['CODE_SIGN_ENTITLEMENTS']='Apple/App/Mac.entitlements';c.build_settings['ENABLE_HARDENED_RUNTIME']='YES'}
ios.build_configurations.each{|c|c.build_settings['CODE_SIGN_ENTITLEMENTS']='Apple/App/iOS.entitlements'}
phase=mac.new_shell_script_build_phase('Build Bun gateway');phase.shell_script='"${SRCROOT}/Apple/scripts/build-sidecar.sh"';phase.input_paths=['${SRCROOT}/apps/gateway/src/index.ts'];phase.output_paths=['${TARGET_BUILD_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}/omodesu-gateway']
[mac,ios].each do|target|scheme=Xcodeproj::XCScheme.new;scheme.add_build_target(target);scheme.set_launch_target(target);scheme.save_as(project.path,target.name,true);end
project.save
# Xcode target script phases execute before CodeSign. The Mac scheme's post-build action examines the completed app.
path='Omodesu.xcodeproj/xcshareddata/xcschemes/OmodesuMac.xcscheme'
xml=File.read(path)
root=File.expand_path('.')
action="<PostActions><ExecutionAction ActionType=\"Xcode.IDEStandardExecutionActionsCore.ExecutionActionType.ShellScriptAction\"><ActionContent title=\"Verify signing identity\" scriptText=\"&quot;#{root}/Apple/scripts/verify-signing.sh&quot; &quot;$(find ~/Library/Developer/Xcode/DerivedData/Omodesu-* -path &apos;*Build/Products/Debug/OmodesuMac.app&apos; -print -quit)&quot;\"><EnvironmentBuildable><BuildableReference BuildableIdentifier=\"primary\" BlueprintIdentifier=\"\" BuildableName=\"\" BlueprintName=\"\" ReferencedContainer=\"container:Omodesu.xcodeproj\"></BuildableReference></EnvironmentBuildable></ActionContent></ExecutionAction></PostActions>"
xml=xml.sub('</BuildAction>',"#{action}</BuildAction>")
File.write(path,xml)
