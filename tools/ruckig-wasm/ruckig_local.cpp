#include <array>
#include <cstddef>

#include <ruckig/ruckig.hpp>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define HCR_RUCKIG_EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define HCR_RUCKIG_EXPORT
#endif

namespace {

constexpr std::size_t kDegreesOfFreedom = 5;
constexpr std::size_t kInputVectorCount = 9;
constexpr std::size_t kOutputVectorCount = 4;
constexpr std::size_t kOutputStride = kDegreesOfFreedom * kOutputVectorCount;

enum InputVector : std::size_t {
  CurrentPosition = 0,
  CurrentVelocity = 1,
  CurrentAcceleration = 2,
  TargetPosition = 3,
  TargetVelocity = 4,
  TargetAcceleration = 5,
  MaxVelocity = 6,
  MaxAcceleration = 7,
  MaxJerk = 8,
};

using Vector = std::array<double, kDegreesOfFreedom>;

Vector read_vector(const double* values, InputVector index) {
  Vector result {};
  const auto offset = static_cast<std::size_t>(index) * kDegreesOfFreedom;
  for (std::size_t joint = 0; joint < kDegreesOfFreedom; ++joint) {
    result[joint] = values[offset + joint];
  }
  return result;
}

void write_vector(double* values, std::size_t offset, const Vector& source) {
  for (std::size_t joint = 0; joint < kDegreesOfFreedom; ++joint) {
    values[offset + joint] = source[joint];
  }
}

}  // namespace

/**
 * Generate one local, offline, synchronized Ruckig state-to-state trajectory.
 *
 * `input` is nine contiguous five-double vectors in this order: current
 * q/v/a, target q/v/a, and max v/a/j. `output` is sample-major q/v/a/j data
 * with a twenty-double stride. The browser controls every input and owns all
 * allocations; this ABI contains no path, scene, program, or network data.
 *
 * Return values are Ruckig's numeric Result codes. A non-negative return is
 * successful and writes `duration_seconds` plus exactly `sample_count`
 * samples, including both endpoints.
 */
extern "C" HCR_RUCKIG_EXPORT int ruckig_sample_5d(
  const double* input,
  int sample_count,
  double* duration_seconds,
  double* output
) {
  if (!input || !duration_seconds || !output || sample_count < 2) {
    return static_cast<int>(ruckig::Result::ErrorInvalidInput);
  }

  ruckig::InputParameter<kDegreesOfFreedom> parameters;
  parameters.current_position = read_vector(input, CurrentPosition);
  parameters.current_velocity = read_vector(input, CurrentVelocity);
  parameters.current_acceleration = read_vector(input, CurrentAcceleration);
  parameters.target_position = read_vector(input, TargetPosition);
  parameters.target_velocity = read_vector(input, TargetVelocity);
  parameters.target_acceleration = read_vector(input, TargetAcceleration);
  parameters.max_velocity = read_vector(input, MaxVelocity);
  parameters.max_acceleration = read_vector(input, MaxAcceleration);
  parameters.max_jerk = read_vector(input, MaxJerk);
  parameters.synchronization = ruckig::Synchronization::Time;

  ruckig::Ruckig<kDegreesOfFreedom> solver;
  ruckig::Trajectory<kDegreesOfFreedom> trajectory;
  const auto result = solver.calculate(parameters, trajectory);
  if (result < ruckig::Result::Working) {
    return static_cast<int>(result);
  }

  const double duration = trajectory.get_duration();
  if (!(duration >= 0.0)) {
    return static_cast<int>(ruckig::Result::ErrorTrajectoryDuration);
  }
  *duration_seconds = duration;

  for (int sample = 0; sample < sample_count; ++sample) {
    const double time = duration * static_cast<double>(sample) /
                        static_cast<double>(sample_count - 1);
    Vector position {};
    Vector velocity {};
    Vector acceleration {};
    Vector jerk {};
    std::size_t section = 0;
    trajectory.at_time(time, position, velocity, acceleration, jerk, section);

    const auto offset = static_cast<std::size_t>(sample) * kOutputStride;
    write_vector(output, offset, position);
    write_vector(output, offset + kDegreesOfFreedom, velocity);
    write_vector(output, offset + 2 * kDegreesOfFreedom, acceleration);
    write_vector(output, offset + 3 * kDegreesOfFreedom, jerk);
  }
  return static_cast<int>(result);
}
