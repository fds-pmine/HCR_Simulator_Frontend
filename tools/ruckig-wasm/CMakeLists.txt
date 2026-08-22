cmake_minimum_required(VERSION 3.20)

project(hcr_ruckig_local_wasm LANGUAGES CXX)

if(NOT DEFINED RUCKIG_SOURCE_DIR)
  message(FATAL_ERROR "RUCKIG_SOURCE_DIR must point to the pinned Ruckig source checkout.")
endif()

# The Cutter Grid integration only permits local state-to-state calls.  Build
# neither examples, test executables, nor Ruckig's cloud client into the WASM
# artefact.
set(BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(BUILD_BENCHMARK OFF CACHE BOOL "" FORCE)
set(BUILD_CLOUD_CLIENT OFF CACHE BOOL "" FORCE)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
add_subdirectory("${RUCKIG_SOURCE_DIR}" "${CMAKE_BINARY_DIR}/ruckig")

add_executable(hcr_ruckig_local ruckig_local.cpp)
target_compile_features(hcr_ruckig_local PRIVATE cxx_std_20)
target_link_libraries(hcr_ruckig_local PRIVATE ruckig::ruckig)

if(EMSCRIPTEN)
  set_target_properties(hcr_ruckig_local PROPERTIES SUFFIX ".mjs")
  target_link_options(hcr_ruckig_local PRIVATE
    "-sMODULARIZE=1"
    "-sEXPORT_ES6=1"
    "-sENVIRONMENT=worker"
    "-sFILESYSTEM=0"
    "-sALLOW_MEMORY_GROWTH=0"
    "-sINITIAL_MEMORY=16777216"
    "-sEXPORTED_FUNCTIONS=['_ruckig_sample_5d','_malloc','_free']"
    "-sEXPORTED_RUNTIME_METHODS=['HEAPF64']"
  )
else()
  message(FATAL_ERROR "This project must be configured through Emscripten.")
endif()
