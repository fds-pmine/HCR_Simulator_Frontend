#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <vector>

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
constexpr std::size_t kMinimumDurationOffset = kDegreesOfFreedom * kInputVectorCount;
constexpr std::size_t kOutputVectorCount = 4;
constexpr std::size_t kOutputTimeOffset = 0;
constexpr std::size_t kOutputVectorOffset = 1;
constexpr std::size_t kOutputStride = kOutputVectorOffset + kDegreesOfFreedom * kOutputVectorCount;
// A state-to-state Community profile has one section, up to two braking
// switches and seven main profile switches per DoF. Reserve every exact jerk
// switch beside the regular temporal grid without requiring a variable-sized
// browser allocation.
constexpr std::size_t kMaximumSwitchTimes = kDegreesOfFreedom * 9;
// Ruckig may expose numerically non-zero profile phases around a zero-length
// analytical switch. Replaying such a phase as its own q/v/a quintic creates
// an artificial, unbounded finite-difference jerk in the browser. It is not
// a physical motion interval, so collapse it deterministically at the ABI
// boundary while retaining every material constant-jerk interval.
constexpr double kMinimumMaterialPhaseSeconds = 1e-9;

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

std::vector<double> sample_times(
  const ruckig::Trajectory<kDegreesOfFreedom>& trajectory,
  int output_capacity
) {
  const double duration = trajectory.get_duration();
  const int uniform_count = std::max(2, output_capacity - static_cast<int>(kMaximumSwitchTimes));
  std::vector<double> times;
  times.reserve(static_cast<std::size_t>(output_capacity));
  for (int sample = 0; sample < uniform_count; ++sample) {
    times.push_back(duration * static_cast<double>(sample) / static_cast<double>(uniform_count - 1));
  }

  const auto profiles = trajectory.get_profiles();
  for (const auto& profiles_for_section : profiles) {
    for (const auto& profile : profiles_for_section) {
      double brake_time = 0.0;
      for (const double phase_duration : profile.brake.t) {
        brake_time += phase_duration;
        if (phase_duration > kMinimumMaterialPhaseSeconds) times.push_back(brake_time);
      }
      for (std::size_t phase = 0; phase < profile.t.size(); ++phase) {
        if (profile.t[phase] > kMinimumMaterialPhaseSeconds) {
          times.push_back(profile.brake.duration + profile.t_sum[phase]);
        }
      }
    }
  }

  std::sort(times.begin(), times.end());
  constexpr double kTimeTolerance = kMinimumMaterialPhaseSeconds;
  times.erase(
    std::remove_if(times.begin(), times.end(), [duration](double time) {
      return !std::isfinite(time) || time < 0.0 || time > duration;
    }),
    times.end()
  );
  times.erase(
    std::unique(times.begin(), times.end(), [](double left, double right) {
      return std::abs(left - right) <= kMinimumMaterialPhaseSeconds;
    }),
    times.end()
  );
  if (times.empty() || times.front() > kTimeTolerance) times.insert(times.begin(), 0.0);
  if (duration - times.back() > kTimeTolerance) times.push_back(duration);
  return times;
}

bool is_jerk_velocity_feasible(
  const Vector& velocity,
  const Vector& acceleration,
  const Vector& max_velocity,
  const Vector& max_acceleration,
  const Vector& max_jerk
) {
  constexpr double kTolerance = 1e-9;
  for (std::size_t joint = 0; joint < kDegreesOfFreedom; ++joint) {
    const double velocity_limit = max_velocity[joint];
    const double acceleration_limit = max_acceleration[joint];
    const double jerk_limit = max_jerk[joint];
    if (!(velocity_limit > 0.0) || !(acceleration_limit > 0.0) || !(jerk_limit > 0.0) ||
        std::abs(velocity[joint]) > velocity_limit + kTolerance ||
        std::abs(acceleration[joint]) > acceleration_limit + kTolerance) {
      return false;
    }
    // A finite jerk needs a²/(2j) velocity margin before a boundary. This is
    // the scalar symmetric-limit condition used by the Worker-side q/v/a
    // projection as well. It prevents the first Ruckig sample from exceeding
    // max velocity when a TOPP-RA node lies on a velocity cap.
    const double positive_acceleration_cap = std::min(
      acceleration_limit,
      std::sqrt(std::max(0.0, 2.0 * jerk_limit * (velocity_limit - velocity[joint])))
    );
    const double negative_acceleration_cap = std::min(
      acceleration_limit,
      std::sqrt(std::max(0.0, 2.0 * jerk_limit * (velocity_limit + velocity[joint])))
    );
    if (acceleration[joint] > positive_acceleration_cap + kTolerance ||
        acceleration[joint] < -negative_acceleration_cap - kTolerance) {
      return false;
    }
  }
  return true;
}

}  // namespace

/**
 * Generate one local, offline, synchronized Ruckig state-to-state trajectory.
 *
 * `input` is nine contiguous five-double vectors in this order: current
 * q/v/a, target q/v/a, and max v/a/j, followed by one non-negative minimum
 * duration in seconds. `output` is sample-major time/q/v/a/j data with a
 * twenty-one-double stride. It includes every exact Community jerk-switch
 * time plus a regular base grid; unused capacity rows carry a negative time
 * sentinel. The browser controls every input and owns all allocations; this
 * ABI contains no path, scene, program, or network data.
 *
 * Return values are Ruckig's numeric Result codes. A non-negative return is
 * successful and writes `duration_seconds` plus at least two trajectory
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
  for (std::size_t index = 0; index <= kMinimumDurationOffset; ++index) {
    if (!std::isfinite(input[index])) {
      return static_cast<int>(ruckig::Result::ErrorInvalidInput);
    }
  }
  if (input[kMinimumDurationOffset] < 0.0) {
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
  if (input[kMinimumDurationOffset] > 0.0) {
    parameters.minimum_duration = input[kMinimumDurationOffset];
  }

  ruckig::Ruckig<kDegreesOfFreedom> solver;
  // `calculate` assumes dynamically feasible q/v/a boundaries. Use the
  // scalar finite-jerk test here rather than Ruckig's optional convenience
  // validator: this keeps the C ABI deterministic in the fixed Emscripten
  // build while rejecting the same velocity-boundary overshoot condition.
  if (!is_jerk_velocity_feasible(
    parameters.current_velocity,
    parameters.current_acceleration,
    parameters.max_velocity,
    parameters.max_acceleration,
    parameters.max_jerk
  ) || !is_jerk_velocity_feasible(
    parameters.target_velocity,
    parameters.target_acceleration,
    parameters.max_velocity,
    parameters.max_acceleration,
    parameters.max_jerk
  )) {
    return static_cast<int>(ruckig::Result::ErrorInvalidInput);
  }
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

  const auto times = sample_times(trajectory, sample_count);
  if (times.size() > static_cast<std::size_t>(sample_count)) {
    return static_cast<int>(ruckig::Result::Error);
  }
  for (int sample = 0; sample < sample_count; ++sample) {
    const auto offset = static_cast<std::size_t>(sample) * kOutputStride;
    if (sample >= static_cast<int>(times.size())) {
      output[offset + kOutputTimeOffset] = -1.0;
      continue;
    }
    const double time = times[static_cast<std::size_t>(sample)];
    Vector position {};
    Vector velocity {};
    Vector acceleration {};
    Vector jerk {};
    std::size_t section = 0;
    trajectory.at_time(time, position, velocity, acceleration, jerk, section);

    output[offset + kOutputTimeOffset] = time;
    write_vector(output, offset + kOutputVectorOffset, position);
    write_vector(output, offset + kOutputVectorOffset + kDegreesOfFreedom, velocity);
    write_vector(output, offset + kOutputVectorOffset + 2 * kDegreesOfFreedom, acceleration);
    write_vector(output, offset + kOutputVectorOffset + 3 * kDegreesOfFreedom, jerk);
  }
  return static_cast<int>(result);
}
